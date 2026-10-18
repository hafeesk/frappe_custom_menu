import frappe
from frappe.model.document import Document


class DockMenuSettings(Document):
	def validate(self):
		self.home_route = (self.home_route or "/desk").strip() or "/desk"
		if not self.home_route.startswith(("/", "http://", "https://")):
			self.home_route = "/" + self.home_route
		if not self.dock_limit or self.dock_limit < 1:
			self.dock_limit = 10

	def on_update(self):
		# the sidebar search index is cached per user
		try:
			frappe.cache.delete_keys("dock_menu_index::")
		except Exception:
			pass
		# /desk opens the Home page (or the apps page again)
		from dock_menu.api import sync_home_default

		sync_home_default(self)
