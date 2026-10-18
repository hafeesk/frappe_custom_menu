app_name = "dock_menu"
app_title = "Dock Menu"
app_publisher = "VKR Holdings"
app_description = "Role-based icon dock + sectioned sidebar menu for Frappe v16"
app_email = "lubaina@vkrholdings.com"
app_license = "mit"
required_apps = ["frappe"]

app_include_js = ["dock_menu.bundle.js"]
app_include_css = ["dock_menu.bundle.css"]

# landing page + pages to register, so the desk never shows the v16 apps page
# (Frappe v16 runs `boot_session`; newer versions may also call `extend_bootinfo`)
boot_session = "dock_menu.api.extend_bootinfo"

# /desk opens the dock Home page (site default desktop:home_page)
after_migrate = ["dock_menu.api.sync_home_default", "dock_menu.api.load_app_workspaces"]
after_install = ["dock_menu.api.sync_home_default", "dock_menu.api.load_app_workspaces"]

# the v16 apps page ("desktop") sends dock users to the Home page / their workspace
page_js = {"desktop": "public/js/desktop_redirect.js"}
