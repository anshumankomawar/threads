import * as i from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "./components/Icon";

// On macOS, each Hugeicons icon we use is drawn as the system's own SF Symbol (Electron's
// `nativeImage.createFromNamedImage`, in the main process): the icons the macOS app has. Elsewhere, and for anything
// without one, the Hugeicons icon stays.
const SYMBOLS = new Map<IconSvgElement, string>([
  [i.Add01Icon, "plus"],
  [i.ArrowDown01Icon, "chevron.down"],
  [i.ArrowExpand01Icon, "arrow.up.left.and.arrow.down.right"],
  [i.ArrowLeft01Icon, "chevron.left"],
  [i.ArrowRight01Icon, "chevron.right"],
  [i.ArrowTurnBackwardIcon, "arrow.uturn.backward"],
  [i.ArrowUp01Icon, "chevron.up"],
  [i.BookOpen01Icon, "book"],
  [i.Bookmark01Icon, "bookmark"],
  [i.Briefcase01Icon, "briefcase"],
  [i.Bug01Icon, "ladybug"],
  [i.Calendar01Icon, "calendar"],
  [i.Calendar03Icon, "calendar"],
  [i.Cancel01Icon, "xmark"],
  [i.ChartBarDecreasingIcon, "chart.bar.xaxis"],
  [i.CheckmarkCircle02Icon, "checkmark.circle"],
  [i.CircleIcon, "circle"],
  [i.Clock01Icon, "clock"],
  [i.CodeIcon, "chevron.left.forwardslash.chevron.right"],
  [i.Coffee01Icon, "cup.and.saucer"],
  [i.CommandIcon, "command"],
  [i.Comment01Icon, "text.bubble"],
  [i.Copy01Icon, "doc.on.doc"],
  [i.CustomerSupportIcon, "headphones"],
  [i.DashboardSquare01Icon, "square.grid.2x2"],
  [i.DatabaseIcon, "cylinder.split.1x2"],
  [i.Delete02Icon, "trash"],
  [i.Diamond01Icon, "diamond"],
  [i.FilterIcon, "line.3.horizontal.decrease"],
  [i.Flag01Icon, "flag"],
  [i.Flag02Icon, "flag"],
  [i.Folder01Icon, "folder"],
  [i.GitBranchIcon, "arrow.triangle.branch"],
  [i.Idea01Icon, "lightbulb"],
  [i.InboxCheckIcon, "archivebox"],
  [i.InboxIcon, "tray"],
  [i.InformationCircleIcon, "info.circle"],
  [i.Invoice01Icon, "doc.text"],
  [i.KeyboardIcon, "keyboard"],
  [i.LayerIcon, "square.stack"],
  [i.Layers01Icon, "square.stack.3d.up"],
  [i.LayoutTwoColumnIcon, "rectangle.split.2x1"],
  [i.Leaf01Icon, "leaf"],
  [i.LeftToRightListBulletIcon, "list.bullet"],
  [i.Logout01Icon, "rectangle.portrait.and.arrow.right"],
  [i.Mail01Icon, "envelope"],
  [i.MailOpen01Icon, "envelope.open"],
  [i.MailReply01Icon, "arrowshape.turn.up.left"],
  [i.Megaphone01Icon, "megaphone"],
  [i.Message01Icon, "bubble.left"],
  [i.MessageAdd01Icon, "plus.bubble"],
  [i.Moon02Icon, "moon"],
  [i.MoreHorizontalIcon, "ellipsis"],
  [i.NoteEditIcon, "note.text"],
  [i.PaintBoardIcon, "paintpalette"],
  [i.PanelLeftIcon, "sidebar.left"],
  [i.PencilEdit01Icon, "pencil"],
  [i.PencilEdit02Icon, "square.and.pencil"],
  [i.Rocket01Icon, "paperplane.circle"],
  [i.Search01Icon, "magnifyingglass"],
  [i.SearchAreaIcon, "text.magnifyingglass"],
  [i.SentIcon, "paperplane"],
  [i.Settings02Icon, "gearshape"],
  [i.Shield01Icon, "shield"],
  [i.SlidersHorizontalIcon, "slider.horizontal.3"],
  [i.Sorting01Icon, "arrow.up.arrow.down"],
  [i.SparklesIcon, "sparkles"],
  [i.SquareArrowUpRightIcon, "arrow.up.right.square"],
  [i.SquareLock01Icon, "lock.square"],
  [i.SquareLock02Icon, "lock"],
  [i.StarIcon, "star"],
  [i.Sun03Icon, "sun.max"],
  [i.Tag01Icon, "tag"],
  [i.Target02Icon, "scope"],
  [i.TextFontIcon, "textformat"],
  [i.Tick02Icon, "checkmark"],
  [i.UnavailableIcon, "nosign"],
  [i.UserAdd01Icon, "person.badge.plus"],
  [i.UserGroupIcon, "person.3"],
  [i.UserIcon, "person"],
  [i.UserMultipleIcon, "person.2"],
  [i.UserSwitchIcon, "person.crop.circle"],
  [i.ViewIcon, "eye"],
  [i.ViewOffIcon, "eye.slash"],
  [i.Wrench01Icon, "wrench.adjustable"],
  [i.ZoomInAreaIcon, "plus.magnifyingglass"],
  [i.ZoomInIcon, "plus.magnifyingglass"],
  [i.ZoomOutAreaIcon, "minus.magnifyingglass"],
]);

// Each symbol drawn at 32pt: its image, and its size in pixels (twice its points).
type Drawn = { url: string; width: number; height: number };
const images = new Map<string, Drawn>();

// Each symbol's image, from the main process, before the app first draws (so nothing swaps in after).
export async function loadSymbols(): Promise<void> {
  if (window.electron?.process.platform !== "darwin") return;
  const names = [...new Set(SYMBOLS.values())];
  const drawn: Record<string, Drawn | null> = await window.electron.ipcRenderer.invoke(
    "sf-symbols",
    names,
  );
  for (const [name, url] of Object.entries(drawn)) if (url) images.set(name, url);
}

// The SF Symbol drawn for a Hugeicons icon, if there is one here.
export const symbolFor = (icon: IconSvgElement): Drawn | undefined => {
  const name = SYMBOLS.get(icon);
  return name === undefined ? undefined : images.get(name);
};
