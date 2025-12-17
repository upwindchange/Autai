import { Cloud, Bot, Code, Info } from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuButton,
	SidebarSeparator,
} from "@/components/ui/sidebar";
import { NavSecondary } from "@/components/side-bar/nav-secondary";
import { useUiStore, type SettingsSection } from "@/stores/uiStore";
import type { ComponentProps } from "react";

interface NavigationItem {
	id: SettingsSection;
	label: string;
	icon: React.ElementType;
}

const navigationItems: (NavigationItem | "separator")[] = [
	{
		id: "providers",
		label: "Providers",
		icon: Cloud,
	},
	{
		id: "models",
		label: "Models",
		icon: Bot,
	},
	"separator",
	{
		id: "development",
		label: "Development",
		icon: Code,
	},
	{
		id: "about",
		label: "About",
		icon: Info,
	},
];

/**
 * Props for the SettingsSidebar component
 */
type SettingsSidebarProps = ComponentProps<typeof Sidebar>;

/**
 * Settings sidebar component that replaces the main sidebar when settings are open.
 * Shows settings navigation sections instead of thread list.
 */
export function SettingsSidebar(props: SettingsSidebarProps) {
	const { activeSettingsSection, setActiveSettingsSection } = useUiStore();

	return (
		<Sidebar className="border-r-0" {...props}>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Settings</SidebarGroupLabel>
					<SidebarMenu>
						{navigationItems.map((item, index) => {
							if (item === "separator") {
								return (
									<SidebarSeparator
										key={`separator-${index}`}
										className="my-2"
									/>
								);
							}

							const Icon = item.icon;
							const isActive = activeSettingsSection === item.id;

							return (
								<SidebarMenuItem key={item.id}>
									<SidebarMenuButton
										onClick={() => setActiveSettingsSection(item.id)}
										isActive={isActive}
									>
										<Icon />
										<span>{item.label}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroup>
				<NavSecondary className="mt-auto" />
			</SidebarContent>
		</Sidebar>
	);
}
