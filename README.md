# Attendly Lite — Daily Attendance Calculator

Track attendance subject by subject from your weekly timetable, handle Sundays and
holidays automatically, and always know how many classes you can safely miss.

## Features
- Subjects + weekly timetable (Mon–Sat, up to 6 periods/day), editable any time
- Each day asks only about that weekday's timetable classes (Present / Absent / No class)
- Change a period's subject while marking when another faculty takes the class
- Overall and per-subject percentages with "can miss / need to attend" predictions
- Calendar, history, edit/delete any day, CSV / PDF / JSON backup + restore
- Light & dark themes, mobile layout, add-to-home-screen

## Settings (environment variables)
| Name | Meaning |
|---|---|
| `DATABASE_URL` | Neon (Postgres) connection string, ends with `?sslmode=require` |
| `SESSION_SECRET` | long random text that signs the login cookie |
| `NODE_ENV` | set to `production` when deployed (makes the cookie HTTPS-only) |
| `TZ` | time zone for "today" (default `Asia/Kolkata`) |

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`
3. `npm run dev` → http://localhost:3000
4. Optional demo data: `npm run seed` (demo@campus.edu / demo1234)

## Deploy
Render (free web service) + Neon (free Postgres). Start command: `npm start`.
