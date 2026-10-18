import re
from pathlib import Path

from setuptools import find_packages, setup

init = Path(__file__).parent / "dock_menu" / "__init__.py"
version = re.search(r'__version__\s*=\s*["\']([^"\']+)', init.read_text()).group(1)

setup(
	name="dock_menu",
	version=version,
	description="Role-based icon dock + sectioned sidebar menu for Frappe v16",
	author="VKR Holdings",
	packages=find_packages(include=["dock_menu*"]),
	zip_safe=False,
	include_package_data=True,
	install_requires=[],
)
