import frappe
from frappe import _
from frappe.model.document import Document


class DockMenuItem(Document):
	def validate(self):
		if not self.workspace and not self.sidebar:
			frappe.throw(_("Set a Workspace or a Workspace Sidebar"))
		if self.abbr:
			self.abbr = self.abbr.strip()[:3]
