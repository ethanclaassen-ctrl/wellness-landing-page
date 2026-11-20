Wellness Landing Page and Leads Dashboard

A demo lead-capture landing page with a login-protected dashboard that tracks leads and revenue. Built with HTML, JavaScript, Tailwind CSS and Supabase (Postgres).
Built with AI assistance. I built this project step by step with an AI assistant. I set up the Supabase database and the login myself, and I am working through the code line by line so I can explain it.
Demo only. All real names, contact details, tracking IDs and database keys have been removed. The form and login will not work until you add your own Supabase project details.
What is in this repo
1.  wellness-landing-page/ is the public landing page. A visitor fills in a short form, and the lead is saved to a Supabase database. It also has privacy and terms pages.
2.  dashboard/ is the private dashboard. You log in with an email and password. It lists warm and cold leads, and tracks revenue and ROI once a lead becomes a client. It is an installable PWA (progressive web app), using manifest.json and a service worker (sw.js).
3.  supabase/migrations/ and dashboard/supabase-schema.sql hold the database setup: tables, row level security rules that control who can read or write each row, and a trigger that runs when a new lead is added.
Tech used
1.  HTML, CSS (Tailwind) and JavaScript
2.  Supabase (Postgres database, login, row level security)
3.  Vercel for hosting
How to run it yourself
1.  Create a free Supabase project and run the SQL files to create the tables.
2.  In dashboard/config.js, replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY with your own project values. Do the same in the landing page's index.html.
3.  Open the pages in a browser, or deploy the folders to Vercel.
