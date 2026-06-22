#!/usr/bin/env python3
"""
Garmin Connect → TrainingLab daily wellness sync (unofficial API).

Fetches resting HR, HRV, sleep, body battery, stress, training readiness,
SpO2 and steps from Garmin Connect and upserts into GarminDailySummary.
Data not available via Strava: HRV, sleep stages, body battery, stress,
training readiness, SpO2, resting HR (accurately).

SETUP ON THE SERVER
-------------------
1.  Install deps:
      pip install garminconnect psycopg2-binary

2.  Find your user ID (run on the server):
      psql $DATABASE_URL -c 'SELECT id, email FROM "User";'

3.  Create /var/www/traininglab/.env.garmin:
      GARMIN_EMAIL=your@email.com
      GARMIN_PASSWORD=yourpassword
      DATABASE_URL=postgresql://user:pass@localhost:5432/traininglab
      TRAININGLAB_USER_ID=your_cuid_from_step_2

4.  First run — authenticate interactively (handles MFA if enabled):
      source /var/www/traininglab/.env.garmin
      python3 /var/www/traininglab/scripts/garmin_sync.py

    Tokens are saved to ~/.garmin_tokens and reused for ~6 months.
    When they expire, repeat step 4.

5.  Add to crontab (crontab -e):
      15 8 * * * source /var/www/traininglab/.env.garmin && python3 /var/www/traininglab/scripts/garmin_sync.py >> /var/log/garmin_sync.log 2>&1

BACKFILL
--------
    python3 garmin_sync.py --date 2026-05-01     # single date
    python3 garmin_sync.py --backfill 30         # last 30 days
"""

import argparse
import logging
import os
import sys
import uuid
from datetime import date, timedelta
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import psycopg2
from garminconnect import Garmin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

EMAIL     = os.environ.get("GARMIN_EMAIL", "")
PASSWORD  = os.environ.get("GARMIN_PASSWORD", "")
DB_URL    = os.environ.get("DATABASE_URL", "")
USER_ID   = os.environ.get("TRAININGLAB_USER_ID", "")
TOKENFILE = os.environ.get("GARMIN_TOKENSTORE", os.path.expanduser("~/.garmin_tokens"))

if not all([EMAIL, PASSWORD, DB_URL, USER_ID]):
    sys.exit(
        "Missing required env vars.\n"
        "Set: GARMIN_EMAIL, GARMIN_PASSWORD, DATABASE_URL, TRAININGLAB_USER_ID"
    )


# ── Garmin auth ──────────────────────────────────────────────────────────────

def get_mfa() -> str:
    return input("Garmin MFA one-time code: ")


def get_client() -> Garmin:
    client = Garmin(EMAIL, PASSWORD, is_cn=False, prompt_mfa=get_mfa)
    try:
        client.login(TOKENFILE)
        log.info("Authenticated via saved tokens")
    except Exception:
        log.info("Saved tokens missing or expired — logging in fresh")
        client.login()
        client.garth.dump(TOKENFILE)
        log.info(f"New tokens saved to {TOKENFILE}")
    return client


# ── Data fetchers ────────────────────────────────────────────────────────────

def safe_call(fn, *args, **kwargs):
    """Call fn(*args) and return the result, or None on any error."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        log.debug(f"{getattr(fn, '__name__', fn)} failed: {e}")
        return None


def fetch_day(client: Garmin, day: date) -> dict:
    d = day.isoformat()
    out: dict = {"date": day}

    # ── Daily summary: resting HR, body battery, respiration, stress, steps ──
    summary = safe_call(client.get_user_summary, d) or {}
    out["restingHR"]       = summary.get("restingHeartRate")
    out["bodyBattery"]     = summary.get("bodyBatteryHighestValue")
    out["respirationRate"] = summary.get("avgWakingRespirationValue")
    out["stressAvg"]       = summary.get("averageStressLevel")
    out["steps"]           = summary.get("totalSteps")

    # ── Sleep ────────────────────────────────────────────────────────────────
    sleep_raw = safe_call(client.get_sleep_data, d) or {}
    dto = sleep_raw.get("dailySleepDTO") or {}
    out["sleepDuration"] = dto.get("sleepTimeSeconds")
    out["sleepDeep"]     = dto.get("deepSleepSeconds")
    out["sleepLight"]    = dto.get("lightSleepSeconds")
    out["sleepRem"]      = dto.get("remSleepSeconds")
    out["sleepAwake"]    = dto.get("awakeSleepSeconds")

    # Sleep score: field name varies across Garmin firmware versions
    score = None
    for key in ("sleepScores", "overallScore", "sleepScore"):
        raw = dto.get(key)
        if isinstance(raw, dict):
            score = raw.get("overall", {}).get("value") or raw.get("value") or raw.get("qualityScore")
        elif isinstance(raw, (int, float)):
            score = int(raw)
        if score is not None:
            break
    out["sleepScore"] = score

    # ── HRV ──────────────────────────────────────────────────────────────────
    hrv_raw = safe_call(client.get_hrv_data, d) or {}
    hrv_summary = hrv_raw.get("hrvSummary") or {}
    out["hrvNightly"] = hrv_summary.get("lastNightAvg")   # RMSSD ms

    status = (hrv_summary.get("status") or "").upper()
    out["hrvBalance"] = (
        "Balanced"   if "BALANCED"   in status else
        "Low"        if "LOW"        in status else
        "Unbalanced" if "UNBALANCED" in status else
        None
    )

    # ── Training Readiness ────────────────────────────────────────────────────
    readiness_raw = safe_call(client.get_training_readiness, d)
    if isinstance(readiness_raw, list) and readiness_raw:
        readiness_raw = readiness_raw[-1]   # most recent entry for the day
    if isinstance(readiness_raw, dict):
        out["trainingReadiness"] = (
            readiness_raw.get("trainingReadinessScore")
            or readiness_raw.get("score")
        )

    # ── SpO2 ──────────────────────────────────────────────────────────────────
    spo2_raw = safe_call(client.get_spo2_data, d) or {}
    all_day = spo2_raw.get("allDay") or {}
    out["spo2Avg"] = all_day.get("averageSPO2") or spo2_raw.get("averageSPO2")

    return out


# ── Database ─────────────────────────────────────────────────────────────────

def clean_db_url(url: str) -> str:
    """Strip Prisma-specific query params that psycopg2 doesn't understand."""
    parsed = urlparse(url)
    allowed = {"sslmode", "sslcert", "sslkey", "sslrootcert"}
    kept = {k: v for k, v in parse_qs(parsed.query).items() if k in allowed}
    return urlunparse(parsed._replace(query=urlencode(kept, doseq=True)))


def upsert(conn, data: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO "GarminDailySummary" (
              "id", "userId", "date",
              "restingHR", "hrvNightly", "hrvBalance",
              "sleepScore", "sleepDuration",
              "sleepDeep", "sleepLight", "sleepRem", "sleepAwake",
              "bodyBattery", "respirationRate",
              "stressAvg", "trainingReadiness", "spo2Avg", "steps"
            ) VALUES (
              %s, %s, %s,
              %s, %s, %s,
              %s, %s,
              %s, %s, %s, %s,
              %s, %s,
              %s, %s, %s, %s
            )
            ON CONFLICT ("userId", "date") DO UPDATE SET
              "restingHR"         = COALESCE(EXCLUDED."restingHR",         "GarminDailySummary"."restingHR"),
              "hrvNightly"        = COALESCE(EXCLUDED."hrvNightly",        "GarminDailySummary"."hrvNightly"),
              "hrvBalance"        = COALESCE(EXCLUDED."hrvBalance",        "GarminDailySummary"."hrvBalance"),
              "sleepScore"        = COALESCE(EXCLUDED."sleepScore",        "GarminDailySummary"."sleepScore"),
              "sleepDuration"     = COALESCE(EXCLUDED."sleepDuration",     "GarminDailySummary"."sleepDuration"),
              "sleepDeep"         = COALESCE(EXCLUDED."sleepDeep",         "GarminDailySummary"."sleepDeep"),
              "sleepLight"        = COALESCE(EXCLUDED."sleepLight",        "GarminDailySummary"."sleepLight"),
              "sleepRem"          = COALESCE(EXCLUDED."sleepRem",          "GarminDailySummary"."sleepRem"),
              "sleepAwake"        = COALESCE(EXCLUDED."sleepAwake",        "GarminDailySummary"."sleepAwake"),
              "bodyBattery"       = COALESCE(EXCLUDED."bodyBattery",       "GarminDailySummary"."bodyBattery"),
              "respirationRate"   = COALESCE(EXCLUDED."respirationRate",   "GarminDailySummary"."respirationRate"),
              "stressAvg"         = COALESCE(EXCLUDED."stressAvg",         "GarminDailySummary"."stressAvg"),
              "trainingReadiness" = COALESCE(EXCLUDED."trainingReadiness", "GarminDailySummary"."trainingReadiness"),
              "spo2Avg"           = COALESCE(EXCLUDED."spo2Avg",           "GarminDailySummary"."spo2Avg"),
              "steps"             = COALESCE(EXCLUDED."steps",             "GarminDailySummary"."steps")
        """, (
            str(uuid.uuid4()), USER_ID, data["date"],
            data.get("restingHR"), data.get("hrvNightly"), data.get("hrvBalance"),
            data.get("sleepScore"), data.get("sleepDuration"),
            data.get("sleepDeep"), data.get("sleepLight"),
            data.get("sleepRem"), data.get("sleepAwake"),
            data.get("bodyBattery"), data.get("respirationRate"),
            data.get("stressAvg"), data.get("trainingReadiness"),
            data.get("spo2Avg"), data.get("steps"),
        ))
    conn.commit()


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Garmin wellness data to TrainingLab")
    parser.add_argument("--date",     metavar="YYYY-MM-DD", help="Sync a specific date (default: yesterday)")
    parser.add_argument("--backfill", type=int, metavar="N", help="Sync the last N days")
    args = parser.parse_args()

    client = get_client()
    conn   = psycopg2.connect(clean_db_url(DB_URL))

    try:
        if args.backfill:
            days = [date.today() - timedelta(days=i) for i in range(1, args.backfill + 1)]
        elif args.date:
            days = [date.fromisoformat(args.date)]
        else:
            days = [date.today() - timedelta(days=1)]

        for day in days:
            data = fetch_day(client, day)
            upsert(conn, data)
            log.info(
                f"{day}  HR={data.get('restingHR')}  "
                f"HRV={data.get('hrvNightly')}  "
                f"sleep={data.get('sleepScore')}  "
                f"readiness={data.get('trainingReadiness')}  "
                f"stress={data.get('stressAvg')}  "
                f"BB={data.get('bodyBattery')}  "
                f"SpO2={data.get('spo2Avg')}  "
                f"steps={data.get('steps')}"
            )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
