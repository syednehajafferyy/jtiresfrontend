# Juniors Automotive & Tire

The full website plus its own backend. No database or npm packages needed, just Node.js 18 or newer.

## Run it

    ADMIN_PASSWORD=choose-a-strong-password node server.js

Then open:

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin

If you leave out ADMIN_PASSWORD, the first start prints a random admin password in the terminal.
Start again with ADMIN_PASSWORD=... any time to change it. Use PORT=8080 to change the port.

## What the backend does

- Serves the site from `public/`.
- Staff sign-in at `/admin` (password, scrypt-hashed, 12-hour session cookie, login attempts rate limited).
- Admin panel: edit tires (name, category, sizes, specs, price, photo upload), edit business details, and see orders.
- Customers place orders from the contact section. Each order records name, phone, tire, size, quantity, notes and time. Anyone can order, no account needed.
- Data is stored as JSON files in `data/` (products.json, business.json, orders.json, uploads/). Back up that folder.

## Put it online

1. Use any host that runs Node (a VPS, Render, Railway, Fly.io). Keep the `data/` folder on persistent storage.
2. Put it behind HTTPS (Caddy, nginx, or the host's built-in HTTPS) and start with:
   `COOKIE_SECURE=1 TRUST_PROXY=1 ADMIN_PASSWORD=... node server.js`
   TRUST_PROXY makes rate limiting use the real visitor address behind a proxy.
3. Do not make `data/` publicly readable. The server already blocks it.

## Files

- `server.js`: web server and API
- `public/index.html`: the whole front end
- `public/img/`: tyre and hero photos
- `data/`: created on first run

## Notes

- Tire names, specs and sizes shown at first are sample data. Replace them in the admin.
- Contact details show placeholders until you save them in Admin > Business.
- Orders are stored only. There is no email or SMS notification yet.
- The photo of the Yokohama wheel in the hero carries that brand name. Make sure you are allowed to use all product photos.
