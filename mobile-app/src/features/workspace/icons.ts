import type { ComponentType } from "react";
import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  Cpu,
  FolderOpen,
  MessageCircle,
  Timer,
} from "lucide-react-native";

import type { RegistryIcon } from "./registries";

type IconComponent = ComponentType<{ size?: number; color?: string }>;

/** The only place registry keys become icon components. */
export const REGISTRY_ICONS: Record<RegistryIcon, IconComponent> = {
  materials: FolderOpen,
  focus: Timer,
  whatsapp: MessageCircle,
  desk: Cpu,
  google: CalendarDays,
  microsoft: CalendarClock,
  moodle: BookOpen,
};
