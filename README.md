# DRS Extrusion Production Management — Installation Guide

This guide covers getting the module installed on an Odoo 18 instance and
configured for first use. It assumes you already have a working Odoo 18
server (self-hosted or Odoo.sh) with admin/developer access.

## 1. Requirements

- **Odoo version:** 18.0
- **Odoo apps this depends on** (already part of standard Odoo, just make
  sure they're installed): `base`, `hr` (Employees), `mrp` (Manufacturing), `web`
- **Python package:** `xlsxwriter` (used to generate the bilingual Excel
  export). Check if it's already available:
  ```bash
  python3 -c "import xlsxwriter"
  ```
  If that errors, install it into the same Python environment your Odoo
  server runs under:
  ```bash
  pip install xlsxwriter --break-system-packages
  # or, inside a virtualenv:
  pip install xlsxwriter
  ```

## 2. Get the module onto the server

Copy the `mrp_drs_production` folder into one of your Odoo instance's addons
paths — wherever your other custom modules live. For example:

```bash
cp -r mrp_drs_production /path/to/odoo/custom-addons/
```

If you're not sure where that is, check the `addons_path` line in your
`odoo.conf`:

```ini
addons_path = /path/to/odoo/addons, /path/to/odoo/custom-addons
```

## 3. Install the module

1. Restart the Odoo service so it picks up the new folder:
   ```bash
   sudo systemctl restart odoo
   # or however your instance is normally restarted
   ```
2. Log into Odoo as an administrator.
3. Turn on developer mode: **Settings → General Settings → scroll to the
   bottom → Activate the developer mode** (or visit `/web?debug=1`).
4. Go to **Apps**.
5. Click **Update Apps List** (top left, under the developer-mode menu) and
   confirm.
6. Remove the default "Apps" filter and search for **DRS Extrusion
   Production Management**.
7. Click **Activate** / **Install**.

If it doesn't show up in the search, double check the folder name matches
`mrp_drs_production` exactly and that it landed in a path listed in
`addons_path`, then repeat step 5.

## 4. Grant access to the right users

Every internal user (`base.group_user`) gets read/write/create access to
production records, extruder lines, and the Excel export wizard by default —
there's no separate DRS-specific security group to configure. If you want to
restrict this to only shop-floor/production staff, that would need a new
security group added on top of the current setup (not included out of the
box) — let me know if you'd like that built in.

## 5. Flag supervisors and technicians

The dashboards pull their supervisor/technician lists from two new flags on
the Employee record, not from a separate list:

1. Go to **Employees**.
2. Open each relevant employee's form.
3. Under developer mode you'll see two new boolean fields added by this
   module: **Is DRS Supervisor** and **Is DRS Technician**. Check the one
   that applies. (If they're not visible on the form by default, you may
   need to add them to the Employee form view, or set them via **Employees
   → list view → select employees → bulk edit**.)

Employees flagged this way will automatically appear in the Supervisor and
Technician dashboards' employee-management tabs, and become selectable as
`supervisor_id` / `technician_ids` on production records.

## 6. Where to find everything

After install, a new top-level menu appears:

- **DRS Extrusion** (root menu)
  - **Dashboard** — the main KPI/trend dashboard
  - Production records, personnel views, and the Excel export wizard are
    reachable from the sub-menus defined in `views/drs_production_views.xml`
    and `views/drs_personnel_views.xml`

## 7. First production entry — quick check

1. Go to **DRS Extrusion → Production** (or wherever the production menu
   ended up) → **New**.
2. Confirm the extruder/zone grid auto-populates with all 8 extruders (A1–A4,
   B1–B4) × 5 zones each — this happens automatically via the model's
   `default_get`.
3. Fill in a few sample readings, save, and confirm the temperature warning
   indicator and computed fields (net weight, weight/meter, spray variance)
   update as expected.
4. From the list view, select a record → **Export Excel** (or run it from
   the Excel wizard) to confirm `xlsxwriter` is working and the output file
   opens correctly.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Module doesn't appear in Apps list | Wrong addons path, or "Update Apps List" wasn't run after copying the folder |
| Install fails mentioning `xlsxwriter` | Python package not installed in the environment Odoo actually runs under (common with virtualenvs or Docker — check you're installing into the right one) |
| Dashboard loads blank / console errors about Chart.js | The dashboard loads `/web/static/lib/Chart/Chart.js` from Odoo's own bundled assets — this ships with Odoo 18 by default; if missing, your Odoo web assets may need rebuilding (`-u web` or clearing the assets cache) |
| Excel export button does nothing | Check the Odoo server log — this usually means the `xlsxwriter` import failed silently; verify step 1 |
| Employee doesn't show up in Supervisor/Technician dashboard | Confirm the corresponding checkbox was actually saved on that employee's record |

---
