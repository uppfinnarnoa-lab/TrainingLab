import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { format, startOfWeek, getISOWeek } from "date-fns";
import { VolumeClient, type VolumeRecord, type WeeklyRecord } from "./volume-client";

function normalizeSport(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("run") || s.includes("trail")) return "Running";
  if (s.includes("ride") || s.includes("cycl")) return "Cycling";
  if (s.includes("nordicski") || s.includes("backcountry")) return "Skiing";
  if (s.includes("rollerski")) return "Roller Skiing";
  if (s.includes("orienteer")) return "Orienteering";
  if (s.includes("weight") || s.includes("strength") || s.includes("workout")) return "Strength";
  return t;
}

export default async function VolumePage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const activities = await prisma.activity.findMany({
    where: { userId },
    select: { sportType: true, distance: true, movingTime: true, startDate: true },
    orderBy: { startDate: "asc" },
  });

  const recordMap = new Map<string, { km: number; timeSec: number }>();
  for (const a of activities) {
    const year = a.startDate.getFullYear();
    const month = a.startDate.getMonth() + 1;
    const sport = normalizeSport(a.sportType);
    const key = `${year}|${month}|${sport}`;
    const e = recordMap.get(key) ?? { km: 0, timeSec: 0 };
    e.km += a.distance / 1000;
    e.timeSec += a.movingTime;
    recordMap.set(key, e);
  }

  const records: VolumeRecord[] = [...recordMap.entries()].map(([key, v]) => {
    const parts = key.split("|");
    return {
      year: Number(parts[0]),
      month: Number(parts[1]),
      sport: parts[2],
      km: Math.round(v.km * 10) / 10,
      timeSec: Math.round(v.timeSec),
    };
  });

  // Weekly records — group by Monday of the week + sport
  const weekMap = new Map<string, { km: number; timeSec: number }>();
  for (const a of activities) {
    const weekStart = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const sport = normalizeSport(a.sportType);
    const key = `${weekStart}|${sport}`;
    const e = weekMap.get(key) ?? { km: 0, timeSec: 0 };
    e.km += a.distance / 1000;
    e.timeSec += a.movingTime;
    weekMap.set(key, e);
  }
  const weeklyRecords: WeeklyRecord[] = [...weekMap.entries()].map(([key, v]) => {
    const [weekStart, sport] = key.split("|");
    const d = new Date(weekStart + "T12:00:00Z");
    return {
      weekStart,
      year: d.getFullYear(),
      isoWeek: getISOWeek(d),
      sport,
      km: Math.round(v.km * 10) / 10,
      timeSec: Math.round(v.timeSec),
    };
  });

  const sports = [...new Set(records.map(r => r.sport))].sort();
  const availableYears = [...new Set(records.map(r => r.year))].sort();

  return <VolumeClient records={records} weeklyRecords={weeklyRecords} sports={sports} availableYears={availableYears} />;
}
