#!/bin/sh
pg_dump -U claudetrainer claudetrainer --data-only \
  -t 'public."SportCategory"' \
  -t 'public."WorkoutType"' \
  -t 'public."AthleteProfile"' \
  -t 'public."Activity"' \
  -t 'public."RaceRecord"' \
  -t 'public."WorkoutTemplate"' \
  -t 'public."WorkoutSection"' \
  -t 'public."PlannedWorkout"' \
  -t 'public."TrainingBlock"' \
  > /tmp/export.sql
echo "Export done, lines: $(wc -l < /tmp/export.sql)"
