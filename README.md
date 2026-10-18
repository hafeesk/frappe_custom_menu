## Dock Menu

Role-based app dock + sectioned sidebar for Frappe / ERPNext v16. It replaces the default sidebar for desk users.

- **Dock** (left rail): Home and Search (Ctrl+K) at the top, one coloured icon per workspace the user's roles allow, **More** (all apps), then Toggle Full Width, Notifications with an unread badge and ToDo. Full width uses Frappe's own setting, so it matches "Toggle Full Width" in the user menu and is remembered per browser.
- **Sidebar**: header (icon · title · company abbreviation, click to switch app), top links, then **collapsible sections**. The open state is remembered, and the current page is highlighted.
  - **Search box** under the header searches **every menu the user may open** (all dock icons and their sub-workspaces, listed under "All menus" with their path) and filters the open menu as you type (all words must match; a matching section title keeps its whole section; matching sub-pages open their parents). Enter opens the first match, ↓/↑ move through results, Esc clears. Alt+M jumps to it.
  - Source: the v16 **Workspace Sidebar** (Section Breaks → sections, link icons kept), or else the workspace's Shortcuts + Link Cards.
  - Every link is checked against DocType / Report / Page permissions, so each role only sees what it can open.
- Hide the sidebar with the button next to its title, show it again with the button under Home in the dock (or Ctrl+B, or click the active dock icon). The page widens and re-aligns when it is hidden. Below 992px the sidebar slides over the page.
- Opening a page from search or a link switches to the app whose menu contains it.

### Expanded dock + workspace menu pages

- The dock is always expanded and lists every workspace the user may open (no "More"; the list scrolls): each icon shows its name (phones under 768px keep the icon rail). Your user menu sits at the bottom of the dock. The Minimize button at the top (or Ctrl+B) shrinks it to an icon rail with tooltips and expands it again; the choice is remembered per browser.
- The sidebar panel is no longer shown. Clicking a workspace in the dock opens `/desk/dock-home/<workspace>`: that workspace's menu as cards straight away (no greeting, search or Recently opened) (one per section, group and sub-workspace; sub-workspaces load by themselves), with a filter box and Edit menu. Links that are not in a section are filed under headings by their module (Selling, Buying, Stock, Accounts, HR, Projects, Assets, then any other module, General last; a report goes under its reference DocType's module), documents before reports.
- A dashboard workspace (charts / number cards / custom blocks and no link cards) opens directly from the dock, as does a menu that is only one link.
- Every workspace page uses the colourful layout, fitted to the screen: shortcuts (compact tiles, live counts) grouped under the workspace page's own headings in page order, then the link cards (heading taken from the page, else "Reports & Masters") in an even grid.
- A workspace with both shortcuts and link cards (e.g. Operations) gets the v14 layout on its page: "Your Shortcuts" (tiles coloured by module, with live record counts) then "Reports & Masters" (one card per module, in its module's colour, masters before reports).
- Workspaces listed in `DIRECT_WS` (top of `dock_menu.bundle.js`, empty by default) open their own workspace page (headings + shortcuts) straight from the dock instead of the menu page.
- No Home button and no Home page: after login (and on /desk or /desk/dock-home) the desk opens the last used workspace's menu, else the first one.
- To bring back the old sidebar panel, set `NO_PANEL = false` at the top of `dock_menu.bundle.js`.

### Menu style (Dock Menu Settings → Menu style)

- **Workspaces (v14)** (default): the same dock + sidebar UI, but **what it lists follows Frappe v14**.
  - Dock icons: the workspaces v14's desk sidebar listed for the user (Workspace Manager sees all; others need an active domain, a module that isn't blocked and that has a DocType they can read, and a shared role in Roles / Custom Role). Hidden pages and "Welcome Workspace" are excluded. Public pages come first, then the user's private ones, each in sequence order. Child workspaces appear as links at the top of their parent's sidebar.
  - Sidebar of a workspace: what v14 showed on that workspace page for the user. That is shortcuts, quick lists, then link cards (plus "Custom Documents" / "Custom Reports" unless Hide Custom is set). Each item is checked with v14's `is_item_allowed`: DocTypes the user can read, permitted Pages in active domains, permitted Reports, and always Dashboards and URLs. Shortcuts limited to an inactive domain, cards for another country and hidden cards are dropped.
  - After login (and from the Home icon) the desk opens the **last visited workspace**, else the first one (see "Open workspace menu instead of the apps page" below).
  - Workspaces v16 itself would not list still open: the app registers them with the v16 router.
  - One difference from v14: some workspaces sit in a module with no DocTypes (HRMS v16 files Leaves, Expenses, Recruitment, Tenure… this way, while their DocTypes stay in "HR"). v14's "readable DocType in the module" check would hide them from everyone but Workspace Managers, so instead they are shown when the user can open at least one item on them.
  - Workspaces from v16 apps (HRMS v16: Leaves, Expenses, Recruitment, Tenure…) have no shortcuts or cards on the page; their menu lives in the v16 Workspace Sidebar of the same name. For such a workspace the sidebar comes from there, each link still checked with v14's rules.
  - Workspaces that v16 files under one app (Desktop Icon parent of type App / Folder, e.g. "Frappe HR") share one dock icon (label without "Frappe ", the app logo). Its sidebar lists each workspace as an expandable entry holding that workspace's menu. An app with only one visible workspace keeps a plain icon.
  - Only permitted items are listed. On top of v14's checks: a DocType needs a role with read (not just a shared document), a report also needs its DocType to be readable, and a dashboard needs read on Dashboard. A workspace with nothing the user may open (and no child workspace that has something) is not shown.
  - **Sub-workspaces** (v14 child workspaces, v16 desktop folders such as Accounting → Invoicing, Payments, Financial Reports…, and Frappe HR's workspaces) are expandable entries under their main menu. Their items are loaded when the entry is opened (click the name or the arrow); opened entries are remembered, and the one holding the current page opens by itself. A workspace named like its folder (Accounting, HR) is folded into it and its menu comes first. Folders whose parent is hidden on the v16 apps page (ERPNext's modules) stay separate icons.
  - **Any link to another workspace** (e.g. "Documents" under "Admin" in a Workspace Sidebar, a workspace link in a card or an edited menu) is an expandable entry: its menu loads when opened, with the same permission checks. Workspace links are shown only when the user may open that workspace.
  - **Custom workspaces** (made on this site, e.g. Admin → Documents) list their own shortcuts / cards plus the links of their Workspace Sidebar; a child (parent_page) is an expandable entry under its parent, loaded when opened.
  - Empty sub-workspace? System Managers get a **Why?** link (or `frappe.call("dock_menu.api.explain_submenu", {workspace: "Documents", user: "x@y.com"})`): parent, whether the user may open it, where its items come from, and each link kept or dropped with the reason.
  - **Parent workspace = main menu**: when a user may open any sub-workspace, its parent is shown as the main menu holding them, even if the user may not open the parent page itself (or it no longer exists, like HR after v16). Such a parent has no page of its own: its dock icon opens the first sub-workspace and its entry only expands.
  - **HR is the main workspace**: Recruitment, Employee Lifecycle, Performance, Shift & Attendance, Expense Claims and Leaves are its sub-workspaces (v14 hierarchy, applied even when v16 cleared their parent). The HR sidebar shows an **HR** entry with HR's own menu, then each sub-workspace as an expandable entry; only workspaces and links the user may open are listed. v16's Expenses / Tenure are hidden when the v14 Expense Claims / Employee Lifecycle are there.
  - **HR menus as in v14**: HRMS v16 emptied the HR workspace pages and dropped "HR". The app ships the v14 HRMS menus (`v14_workspaces/`: HR, Recruitment, Employee Lifecycle, Performance, Shift & Attendance, Expense Claims, Leaves) and uses them for any of these workspaces whose page is empty. Each card is an expandable sub-menu; a workspace with child workspaces gets an entry named after itself first (e.g. **HR** under HR) holding its own shortcuts and cards. Links to DocTypes / reports that no longer exist or the user cannot open are dropped.
  - Child workspaces (v14 parent_page) appear in their parent's sidebar as expandable entries holding their own menu. A parent that only groups children opens its single child automatically.
  - Dock Menu Item records only restyle an icon in this mode (label, icon, letters, colour, image).
  - Why is a workspace missing for someone? As System Manager, in the browser console:
    `frappe.call("dock_menu.api.explain_v14_menu", {user: "x@y.com"}).then(r => console.table(r.message))`
- **Workspace Sidebar (v16)**: one dock icon per workspace with its sectioned v16 sidebar (below).

### Configure (System Manager)

- **Edit a sidebar menu in place**: the pencil next to the menu title (and on each sub-workspace when hovering it) opens an editor with the current menu as rows: rename, hide, drag to reorder, add Links (DocType / Report / Page / Dashboard / URL / Workspace), Sections, Sub-workspaces (expand into that workspace's menu) and Spacers. Saved as a **Dock Menu Layout** (one per menu) that replaces the automatic menu for everyone; links are still checked against each user's permissions. "Reset to automatic" deletes it. All edited menus: user menu → Edited Menus.

- **Home page** (`/desk/dock-home`, default landing — Dock Menu Settings → Desk opens): greeting, a search across every permitted menu (press `/`), recently opened pages, and a card per workspace the user may open with its first links and sub-workspace chips. Clicking a card or link also switches the sidebar to that workspace. Set "Desk opens" to "Last used workspace" for the previous behaviour.
- **Personal menus**: edits are saved per user (Dock Menu Layout with For user) and change only that user's menu; System Managers can tick "Apply to everyone" in the full editor for the shared menu. "Reset my changes" goes back to the shared / automatic menu.
- **Edit menus from the Home page** (who: Dock Menu Settings → Who can edit menus, default All users): click **Edit** on a workspace card to switch it to edit mode, which shows **＋ Add** (a DocType list, report, page, dashboard, URL or sub-workspace, optionally into a section) and **Edit menu** (the full editor: reorder, sections, hide); hovering a link or sub-workspace chip shows **rename** and **remove**. Changes are saved as that menu's Dock Menu Layout and show in the sidebar too; links stay permission-checked.
- **No v16 apps page for dock users**: in Home page mode `/desk` itself draws the Home page (boot `home_page`, via the `boot_session` hook); otherwise the landing workspace comes with the boot data, so when the desk would open the apps page (after login, Home, the logo, typing /desk) the address is switched to the workspace before anything is drawn.
- **Dock Menu Settings → Open workspace menu instead of the apps page** (on by default, both menu styles): after login and from the Home icon the desk skips the v16 apps grid and opens the last used workspace (else the first one) with its sidebar menu shown. The apps grid is kept hidden while it redirects. Turn it off, or set a custom Home route, to keep the apps page.
- **Dock Menu Settings**: enable, also for System Managers, Home icon route (e.g. `/desk/role-desk`), subtitle (company abbr / company / none), icons before "More" (default 10), what a dock click opens, which dock tools to show.
- **Dock Menu Item** (optional): label, sequence, Workspace and/or Workspace Sidebar, icon (Lucide name), letters (e.g. `OI`), colour, image, **Roles**.
  - No items → every permitted top-level workspace is shown automatically.
  - With items → only those, each limited to its Roles (empty = everyone who can open the workspace).

### Install

```bash
cd ~/frappe-bench
cp -r dock_menu apps/            # or: bench get-app <git-url>
./env/bin/pip install -e apps/dock_menu
bench --site <site> install-app dock_menu
bench build --app dock_menu
bench --site <site> clear-cache && bench restart
```

Note: don't enable this and `workspace_sidebar_menu` for the same users — both replace the desk sidebar.
