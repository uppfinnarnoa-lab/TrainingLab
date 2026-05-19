"use client";

import { ExternalLink } from "lucide-react";
import { SetupGuide, GARMIN_GUIDE } from "@/components/setup-guide";

interface Props {
  connected: boolean;
  authUrl: string;
}

export function GarminConnectSection({ connected, authUrl }: Props) {
  return (
    <div className="space-y-4">
      <SetupGuide steps={GARMIN_GUIDE} defaultOpen={!connected} />

      {!connected ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Garmin provides HRV and sleep data for your daily readiness score.
            The Garmin Health API requires a developer application — see the guide above.
          </p>
          <a
            href={authUrl}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            <ExternalLink size={15} />
            Connect with Garmin
          </a>
        </div>
      ) : (
        <p className="text-sm text-accent">
          ✓ Garmin is connected. HRV and sleep data syncs daily at 08:00.
        </p>
      )}
    </div>
  );
}
