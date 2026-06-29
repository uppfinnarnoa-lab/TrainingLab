"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  text: string;
  link?: { label: string; url: string };
  code?: string;
}

interface Props {
  steps: Step[];
  defaultOpen?: boolean;
}

export function SetupGuide({ steps, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 transition text-left"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        Setup guide
      </button>

      {open && (
        <ol className="divide-y divide-border">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm text-primary leading-snug">{step.text}</p>
                {step.link && (
                  <a
                    href={step.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <ExternalLink size={11} />
                    {step.link.label}
                  </a>
                )}
                {step.code && (
                  <code className="block text-xs font-mono bg-surface-2 border border-border rounded-lg px-3 py-2 text-muted break-all">
                    {step.code}
                  </code>
                )}
              </div>
            </li>
          ))}
          <li className="flex items-center gap-2 px-4 py-3 bg-accent/5">
            <CheckCircle size={14} className="text-accent" />
            <p className="text-xs text-muted">Fill in the values above and save.</p>
          </li>
        </ol>
      )}
    </div>
  );
}

export const STRAVA_GUIDE: Step[] = [
  {
    text: "Go to your Strava API settings page and create a new application.",
    link: { label: "strava.com/settings/api", url: "https://www.strava.com/settings/api" },
  },
  {
    text: 'Give it any name (e.g. "TrainingLab"). Set the "Authorization Callback Domain" to your domain (or localhost for local dev).',
  },
  {
    text: 'After creating the app, copy the "Client ID" and "Client Secret" into your .env.local file.',
    code: "STRAVA_CLIENT_ID=your_id\nSTRAVA_CLIENT_SECRET=your_secret",
  },
  {
    text: 'Set the redirect URI to match your environment.',
    code: "# Local dev:\nSTRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback\n\n# Production:\nSTRAVA_REDIRECT_URI=https://yourdomain.com/api/strava/callback",
  },
  {
    text: 'Restart the dev server, then click "Connect with Strava" below to authorize.',
  },
];

export const GARMIN_GUIDE: Step[] = [
  {
    text: "Register as a Garmin Health API developer. Note: Garmin requires a formal application — approval can take a few days.",
    link: { label: "developer.garmin.com/health-api", url: "https://developer.garmin.com/health-api/overview/" },
  },
  {
    text: "Once approved, create a new application in the Garmin developer portal and note your Client ID and Secret.",
  },
  {
    text: "Set the redirect URI in the Garmin portal to match your environment.",
    code: "# Local dev:\nhttp://localhost:3000/api/garmin/callback",
  },
  {
    text: "Add the credentials to your .env.local.",
    code: "GARMIN_CLIENT_ID=your_id\nGARMIN_CLIENT_SECRET=your_secret",
  },
  {
    text: "Restart the dev server and connect below to start syncing HRV and sleep data.",
  },
];

export const CLAUDE_GUIDE: Step[] = [
  {
    text: "Create an Anthropic account and go to the API console.",
    link: { label: "console.anthropic.com", url: "https://console.anthropic.com" },
  },
  {
    text: 'In the console, click "API Keys" → "Create Key". Give it a name like "TrainingLab".',
  },
  {
    text: "Copy the key (starts with sk-ant-) and paste it into the field above. The key is stored encrypted in your database.",
  },
  {
    text: 'Set a monthly budget in the field below — you\'ll get warnings at 80% and a notice at 100%. Estimated cost: $1–5/month with typical usage.',
  },
];

export const GOOGLE_CALENDAR_GUIDE: Step[] = [
  {
    text: "Create (or reuse) a project in Google Cloud Console, then enable the Google Calendar API for it.",
    link: { label: "console.cloud.google.com", url: "https://console.cloud.google.com" },
  },
  {
    text: 'On the OAuth consent screen, add the scope ".../auth/calendar.app.created" and add yourself as a Test user. Once it works, switch Publishing status to "In production" — otherwise refresh tokens expire after ~7 days (no Google review needed for this scope).',
  },
  {
    text: 'Under Credentials, create an OAuth client ID of type "Web application", and add the redirect URI below as an Authorized redirect URI.',
  },
  {
    text: "Copy the Client ID and Client Secret into the fields above and save.",
  },
  {
    text: 'Click "Connect with Google" below — each user (including you) connects their own calendar with the same Client ID/Secret. A dedicated "TrainingLab" calendar is created automatically on first connect.',
  },
];

export const GEMINI_GUIDE: Step[] = [
  {
    text: "Go to Google AI Studio and create a free API key. No credit card needed for the free tier.",
    link: { label: "aistudio.google.com/app/apikey", url: "https://aistudio.google.com/app/apikey" },
  },
  {
    text: "Copy the key and paste it into the field above. The free tier gives you 15 requests/min, 1M tokens/min, 1500 requests/day — more than enough.",
  },
  {
    text: "Select Gemini as your active provider in the dropdown above, then start chatting with your coach.",
  },
];
