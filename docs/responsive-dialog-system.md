# Responsive Dialog/Drawer System - Technical Documentation

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Architecture Overview](#architecture-overview)
4. [Core Components](#core-components)
5. [Key Patterns & Techniques](#key-patterns--techniques)
6. [Implementation Details](#implementation-details)
7. [Expansion Plan](#expansion-plan)
8. [Universal Component Vision](#universal-component-vision)

---

## Executive Summary

This document describes the refactoring work done to create a responsive dialog/drawer system that:

- **Preserves form state** when transitioning between desktop (Dialog) and mobile (Drawer) modes
- **Handles viewport transitions** gracefully without closing or losing state
- **Manages nested components** (dialogs opened from dropdowns/drawers) correctly
- **Intercepts mobile back gestures** to close drawers instead of navigating away

The system serves as a foundation for a unified responsive component architecture that can be expanded to all "portal" components (selects, dropdowns, comboboxes, popovers, etc.).

---

## Problem Statement

### The Core Challenge

Modern web applications need to provide optimal UX on both desktop and mobile. For interactive overlay components, this typically means:

| Desktop | Mobile |
|---------|--------|
| Dialog (centered modal) | Drawer (bottom sheet) |
| Dropdown Menu | Drawer with menu items |
| Popover | Drawer |
| Select | Drawer with options |

The challenge is that **switching between these components** (e.g., when resizing the viewport or rotating a device) traditionally causes:

1. **State Loss**: Form inputs, selections, and scroll positions are lost
2. **Unexpected Closing**: The component closes during the transition
3. **Navigation Issues**: On mobile, the back gesture navigates away instead of closing
4. **Nested Component Problems**: Opening a dialog from a dropdown causes both to close

### Specific Issues We Solved

1. **Hydration Race Conditions**: `useMediaQuery` and `useIsMobile` return `false` initially before hydration completes, causing false "viewport transition" detection
2. **Component Unmounting**: When parent components (like DropDrawer) transition between modes, their children (dialogs) unmount
3. **History Stack Management**: Mobile back gesture handling requires careful coordination when multiple drawers are nested
4. **State Preservation**: React's component tree changes when switching Dialog↔Drawer, destroying state

---

## Architecture Overview

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (more-button.tsx, page components)                          │
├─────────────────────────────────────────────────────────────┤
│                    Dialog Components                         │
│  (AddSubjectDialog, AddGradeDialog, AddPeriodDialog)        │
├─────────────────────────────────────────────────────────────┤
│                    Responsive Wrappers                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Credenza   │  │ DropDrawer  │  │  (Future: others)   │  │
│  │ Dialog/     │  │ Dropdown/   │  │  Select/Drawer      │  │
│  │ Drawer      │  │ Drawer      │  │  Combobox/Drawer    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    Primitive Components                      │
│  ┌────────┐ ┌────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ Dialog │ │ Drawer │ │ DropdownMenu │ │ Select (Radix) │  │
│  │(Radix) │ │(Vaul)  │ │   (Radix)    │ │                │  │
│  └────────┘ └────────┘ └──────────────┘ └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌──────────────────┐
│   Parent State   │  (e.g., more-button.tsx)
│  - dialogOpen    │
│  - dropDrawerOpen│
└────────┬─────────┘
         │ Controlled props (open, onOpenChange)
         ▼
┌──────────────────┐
│ Responsive       │  (Credenza, DropDrawer)
│ Wrapper          │
│ - viewport detect│
│ - transition mgmt│
└────────┬─────────┘
         │ Passes to appropriate primitive
         ▼
┌──────────────────┐
│ Dialog or Drawer │  (Based on viewport)
│ - history mgmt   │
│ - back gesture   │
└──────────────────┘
```

---

## Core Components

### 1. Credenza (`credenza.tsx`)

**Purpose**: Responsive Dialog/Drawer that preserves form state across viewport transitions.

**Key Features**:
- Renders as `Dialog` on desktop (≥768px), `Drawer` on mobile (<768px)
- `reparentableContent` prop for state-preserving content
- `CredenzaFormSlot` component marks where reparentable content appears
- Viewport transition detection to prevent false close events

**API**:
```tsx
interface RootCredenzaProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  reparentableContent?: React.ReactNode; // Content that survives viewport changes
}
```

**Usage**:
```tsx
<Credenza
  open={open}
  onOpenChange={setOpen}
  reparentableContent={<MyForm onClose={() => setOpen(false)} />}
>
  <CredenzaTrigger>Open</CredenzaTrigger>
  <CredenzaContent>
    <CredenzaHeader>
      <CredenzaTitle>Title</CredenzaTitle>
    </CredenzaHeader>
    <CredenzaBody>
      <CredenzaFormSlot /> {/* Form renders here */}
    </CredenzaBody>
  </CredenzaContent>
</Credenza>
```

### 2. DropDrawer (`dropdrawer.tsx`)

**Purpose**: Responsive DropdownMenu/Drawer with submenu support.

**Key Features**:
- Renders as `DropdownMenu` on desktop, `Drawer` on mobile
- Supports nested submenus with animated transitions on mobile
- Controlled mode support for coordination with parent components
- `closeOnSelect` prop for items that open dialogs

**API**:
```tsx
interface DropDrawerProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DropDrawerItemProps {
  closeOnSelect?: boolean; // Set to false for dialog triggers
  // ... other props
}
```

**Usage**:
```tsx
<DropDrawer open={open} onOpenChange={setOpen}>
  <DropDrawerTrigger>
    <Button>Menu</Button>
  </DropDrawerTrigger>
  <DropDrawerContent>
    <DropDrawerItem onClick={handleAction}>Action</DropDrawerItem>
    <DropDrawerItem closeOnSelect={false} onClick={openDialog}>
      Open Dialog
    </DropDrawerItem>
  </DropDrawerContent>
</DropDrawer>
```

### 3. Drawer (`drawer.tsx`)

**Purpose**: Enhanced Vaul drawer with mobile back gesture interception.

**Key Features**:
- Pushes history state when opening on mobile
- Intercepts back gesture to close drawer instead of navigating
- Supports nested drawers with proper stack management
- Handles link navigation without breaking history

**Implementation Details**:
```tsx
// Global state for nested drawer management
const __drawerOpenStack: number[] = [];      // Stack of open drawer IDs
const __drawerCloseFromBack = new Map();     // Close handlers by ID
let __drawerSuppressNextPop = false;         // Suppress programmatic pops

// Each drawer instance:
// 1. Gets unique ID
// 2. Pushes to stack when opening
// 3. Registers close handler
// 4. Pops from stack when closing
```

### 4. Dialog Components (e.g., `add-subject-dialog.tsx`)

**Purpose**: Application-level dialog components that use Credenza.

**Key Features**:
- Support both controlled and uncontrolled modes
- Use `reparentableContent` for forms
- Form state resets when dialog closes (via `useCredenzaContext`)

**Pattern**:
```tsx
export default function AddSubjectDialog({
  children,
  yearId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  // Support both controlled and uncontrolled
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  return (
    <Credenza
      open={open}
      onOpenChange={setOpen}
      reparentableContent={
        <AddSubjectForm close={() => setOpen(false)} yearId={yearId} />
      }
    >
      {children && <CredenzaTrigger asChild>{children}</CredenzaTrigger>}
      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
        </CredenzaHeader>
        <CredenzaBody>
          <CredenzaFormSlot />
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
```

---

## Key Patterns & Techniques

### 1. Reparentable Content Pattern

**Problem**: When switching between Dialog and Drawer, React unmounts one and mounts the other, destroying all state.

**Solution**: Create a stable DOM element that survives the switch and use React portals.

```tsx
function useStableHost() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "contents";
    hostRef.current.setAttribute("data-credenza-stable-host", "true");
  }

  return hostRef.current;
}

// In Credenza:
const stableHost = useStableHost();

// Render content into stable host
{stableHost && createPortal(reparentableContent, stableHost)}

// Move stable host to current slot (Dialog or Drawer content area)
React.useEffect(() => {
  if (stableHost && currentSlot) {
    currentSlot.appendChild(stableHost);
  }
}, [stableHost, currentSlot]);
```

### 2. Hydration-Safe Viewport Detection

**Problem**: `useMediaQuery` returns `false` during SSR/hydration, causing false "viewport transition" detection.

**Solution**: Track mount state and only detect transitions after hydration.

```tsx
const hasMountedRef = React.useRef(false);
const prevIsDesktopRef = React.useRef(isDesktop);
const isTransitioningRef = React.useRef(false);

// Mark as mounted after first effect
React.useEffect(() => {
  hasMountedRef.current = true;
}, []);

// Only detect transitions after mount
if (hasMountedRef.current && prevIsDesktopRef.current !== isDesktop && open) {
  isTransitioningRef.current = true;
}
prevIsDesktopRef.current = isDesktop;
```

### 3. Viewport Transition Guarding

**Problem**: When viewport changes while a dialog is open, the underlying Dialog/Drawer component fires `onOpenChange(false)`.

**Solution**: Temporarily ignore close events during viewport transitions.

```tsx
const handleOpenChange = React.useCallback(
  (newOpen: boolean) => {
    // Ignore close events during viewport transitions
    if (!newOpen && isTransitioningRef.current) {
      return;
    }
    onOpenChange?.(newOpen);
  },
  [onOpenChange]
);

// Reset transition flag after animation completes
React.useEffect(() => {
  if (isTransitioningRef.current) {
    const timer = setTimeout(() => {
      isTransitioningRef.current = false;
    }, 300);
    return () => clearTimeout(timer);
  }
}, [isDesktop]);
```

### 4. Coordinated Parent-Child State

**Problem**: Opening a dialog from a DropDrawer causes the dialog to be unmounted when DropDrawer transitions.

**Solution**: Render dialogs outside (as siblings to) the DropDrawer and coordinate state.

```tsx
// In more-button.tsx:
export default function MoreButton({ yearId }: Props) {
  const [dropDrawerOpen, setDropDrawerOpen] = useState(false);
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);

  const openDialog = useCallback((setDialogOpen) => {
    setDropDrawerOpen(false);  // Hide parent
    setDialogOpen(true);       // Show child
  }, []);

  const handleDialogClose = useCallback((open: boolean) => {
    setSubjectDialogOpen(open);
    if (!open) {
      setDropDrawerOpen(true); // Re-show parent when child closes
    }
  }, []);

  return (
    <>
      {/* Dialog rendered OUTSIDE DropDrawer */}
      <AddSubjectDialog
        open={subjectDialogOpen}
        onOpenChange={handleDialogClose}
      />

      <DropDrawer open={dropDrawerOpen} onOpenChange={setDropDrawerOpen}>
        <DropDrawerContent>
          <DropDrawerItem
            closeOnSelect={false}
            onClick={() => openDialog(setSubjectDialogOpen)}
          >
            Add Subject
          </DropDrawerItem>
        </DropDrawerContent>
      </DropDrawer>
    </>
  );
}
```

### 5. Mobile History Stack Management

**Problem**: Mobile back gesture should close drawers, not navigate away.

**Solution**: Push history state when opening, consume when closing.

```tsx
// Global stack for nested drawers
const __drawerOpenStack: number[] = [];
const __drawerCloseFromBack = new Map<number, () => void>();

// On drawer open (mobile):
window.history.pushState({ __drawer: true, id: drawerId }, "", location.href);
__drawerOpenStack.push(drawerId);
__drawerCloseFromBack.set(drawerId, closeHandler);

// On back gesture:
window.addEventListener("popstate", (ev) => {
  const topId = __drawerOpenStack[__drawerOpenStack.length - 1];
  if (topId != null) {
    const close = __drawerCloseFromBack.get(topId);
    if (close) close(); // Close drawer instead of navigating
  }
});

// On drawer close (programmatic):
__drawerSuppressNextPop = true; // Suppress our own history.back()
window.history.back();          // Consume the pushed state
```

### 6. Form Reset on Close

**Problem**: Form state should reset when dialog closes, but persist during viewport transitions.

**Solution**: Use Credenza context to detect close and reset after animation.

```tsx
// In form component:
const credenzaContext = useCredenzaContext();
const prevOpenRef = React.useRef(credenzaContext?.open);

React.useEffect(() => {
  const wasOpen = prevOpenRef.current;
  const isOpen = credenzaContext?.open;

  if (wasOpen && !isOpen) {
    // Dialog closed - reset after animation
    const timer = setTimeout(() => {
      form.reset();
    }, 300);
    return () => clearTimeout(timer);
  }

  prevOpenRef.current = isOpen;
}, [credenzaContext?.open, form]);
```

---

## Implementation Details

### File Structure

```
components/
├── ui/
│   ├── credenza.tsx          # Responsive Dialog/Drawer wrapper
│   ├── dropdrawer.tsx        # Responsive Dropdown/Drawer wrapper
│   ├── drawer.tsx            # Enhanced Vaul drawer with back gesture
│   ├── dialog.tsx            # Radix Dialog (unchanged)
│   ├── dropdown-menu.tsx     # Radix Dropdown (unchanged)
│   └── use-media-query.tsx   # Viewport detection hook
├── dialogs/
│   ├── add-subject-dialog.tsx
│   ├── add-grade-dialog.tsx
│   └── add-period-dialog.tsx
├── forms/
│   ├── add-subject-form.tsx
│   ├── add-grade-form.tsx
│   └── add-period-form.tsx
└── buttons/
    └── dashboard/
        └── more-button.tsx   # Example of coordinated state pattern
```

### Context Structure

```tsx
// Credenza Context
interface CredenzaContextValue {
  isDesktop: boolean;
  open: boolean;
  stableHost: HTMLDivElement | null;
  registerSlot: (element: HTMLDivElement | null) => void;
}

// DropDrawer Context
interface DropDrawerContextValue {
  isMobile: boolean;
  close: () => void;
  isOpen: boolean;
  lockMode: () => void;   // Prevent mode transitions
  unlockMode: () => void;
}
```

---

## Current Implementation Analysis

### Existing Responsive Components Comparison

| Feature | DropDrawer | SelectDrawer | Credenza |
|---------|------------|--------------|----------|
| Responsive switching | ✅ | ✅ | ✅ |
| Controlled mode | ✅ | ❌ | ✅ |
| Hydration-safe detection | ✅ | ❌ | ✅ |
| Viewport transition guarding | ✅ | ❌ | ✅ |
| State preservation | ❌ (not needed) | ❌ | ✅ (`reparentableContent`) |
| closeOnSelect prop | ✅ | ❌ | N/A |
| lockMode/unlockMode | ✅ | ❌ | N/A |
| Submenu support | ✅ | ❌ | N/A |
| Back gesture handling | ✅ (via Drawer) | ✅ (via Drawer) | ✅ (via Drawer) |

### SelectDrawer Current State

**Location**: `apps/client/src/components/ui/selectdrawer.tsx`

**Current Features**:
- Basic responsive switching (Select on desktop, Drawer on mobile)
- Value/onValueChange props for selection
- SelectDrawerGroup for visual grouping
- SelectDrawerSeparator for visual separation

**Missing Features** (compared to DropDrawer):
1. **Controlled open state** - Cannot control open/close externally
2. **Hydration-safe viewport detection** - Uses raw `useIsMobile()` without `hasMountedRef`
3. **Viewport transition guarding** - No `isViewportTransitionRef` to prevent false closes
4. **closeOnSelect prop** - Items always close the drawer (problematic for nested dialogs)

**Current Usage Examples**:

```tsx
// year-workspace-select.tsx - Basic selection
<SelectDrawer value={activeId} onValueChange={(value) => { ... }}>
  <SelectDrawerTrigger placeholder="Select year">
    {years.find(y => y.id === activeId)?.name}
  </SelectDrawerTrigger>
  <SelectDrawerContent title="Select Year">
    <SelectDrawerGroup>
      {years.map(year => (
        <SelectDrawerItem value={year.id} key={year.id}>
          {year.name}
        </SelectDrawerItem>
      ))}
    </SelectDrawerGroup>
  </SelectDrawerContent>
</SelectDrawer>

// theme-section.tsx - Simple theme selection
<SelectDrawer onValueChange={setTheme} value={theme}>
  <SelectDrawerTrigger className="capitalize w-full">
    {theme}
  </SelectDrawerTrigger>
  <SelectDrawerContent title="Theme">
    <SelectDrawerGroup>
      <SelectDrawerItem value="system">System</SelectDrawerItem>
      <SelectDrawerItem value="light">Light</SelectDrawerItem>
      <SelectDrawerItem value="dark">Dark</SelectDrawerItem>
    </SelectDrawerGroup>
  </SelectDrawerContent>
</SelectDrawer>
```

### DropDrawer Current State (Reference Implementation)

**Location**: `apps/client/src/components/ui/dropdrawer.tsx`

**Full Features**:
- Responsive switching (DropdownMenu on desktop, Drawer on mobile)
- Controlled mode (`open`, `onOpenChange` props)
- Hydration-safe viewport detection (`hasMountedRef`)
- Viewport transition guarding (`isViewportTransitionRef`)
- `closeOnSelect` prop for dialog triggers
- `lockMode`/`unlockMode` for preventing transitions during nested operations
- Animated submenu navigation on mobile
- Group styling with separators

**Current Usage Examples**:

```tsx
// subject-more-button.tsx - Basic dropdown with nested dialogs
<DropDrawer>
  <DropDrawerTrigger asChild>
    <Button size="icon" variant="outline">
      <EllipsisVerticalIcon />
    </Button>
  </DropDrawerTrigger>
  <DropDrawerContent>
    <DropDrawerGroup>
      {/* Dialog as trigger - uses onSelect={(e) => e.preventDefault()} */}
      <AddGradeDialog yearId={subject.yearId}>
        <DropDrawerItem onSelect={(e) => e.preventDefault()}>
          <PlusCircleIcon /> Add Grade
        </DropDrawerItem>
      </AddGradeDialog>
    </DropDrawerGroup>
    <DropDrawerGroup>
      <UpdateSubjectDialog subjectId={subject.id} />
      <DeleteSubjectDialog subject={subject} />
    </DropDrawerGroup>
  </DropDrawerContent>
</DropDrawer>

// more-button.tsx - Coordinated state with external dialogs (refactored pattern)
const [dropDrawerOpen, setDropDrawerOpen] = useState(false);
const [dialogOpen, setDialogOpen] = useState(false);

<>
  <AddSubjectDialog open={dialogOpen} onOpenChange={handleDialogChange} />
  <DropDrawer open={dropDrawerOpen} onOpenChange={setDropDrawerOpen}>
    <DropDrawerContent>
      <DropDrawerItem closeOnSelect={false} onClick={() => openDialog(setDialogOpen)}>
        Add Subject
      </DropDrawerItem>
    </DropDrawerContent>
  </DropDrawer>
</>
```

---

## Expansion Plan

### Phase 1: Migrate SelectDrawer to Match DropDrawer Patterns

**Goal**: Update SelectDrawer to have feature parity with DropDrawer.

**Components to Audit**:

| Component | Current Implementation | Desktop Mode | Mobile Mode | Priority |
|-----------|----------------------|--------------|-------------|----------|
| SelectDrawer | Partial | Select | Drawer | **HIGH** |
| Combobox | None | Popover | Drawer | High |
| DatePicker | Custom | Popover | Drawer | Medium |
| ColorPicker | Custom | Popover | Drawer | Low |
| Tooltip | Radix Tooltip | Tooltip | Touch-friendly | Low |
| ContextMenu | Radix ContextMenu | Context Menu | Long-press Drawer | Medium |
| AlertDialog | Radix AlertDialog | Dialog | Drawer | Medium |
| Popover | Radix Popover | Popover | Drawer | Medium |

### Phase 2: Refactor SelectDrawer Component

**Goal**: Update the existing SelectDrawer to match DropDrawer's patterns.

**Current Code Analysis** (`selectdrawer.tsx`):

```tsx
// CURRENT - Missing key features
function SelectDrawer({
  children,
  value,
  onValueChange,
  ...props
}: React.ComponentProps<typeof Select> & { children: React.ReactNode }) {
  const isMobile = useIsMobile(); // ❌ No hydration safety

  if (isMobile) {
    return (
      <SelectDrawerContext.Provider value={{ isMobile, value, onValueChange }}>
        <Drawer {...props}> {/* ❌ No controlled open state */}
          {children}
        </Drawer>
      </SelectDrawerContext.Provider>
    );
  }
  // ...
}
```

**Refactored Implementation**:

```tsx
// REFACTORED - With all patterns from DropDrawer

interface SelectDrawerContextValue {
  isMobile: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  close: () => void;
  isOpen: boolean;
}

const SelectDrawerContext = React.createContext<SelectDrawerContextValue>({
  isMobile: false,
  close: () => {},
  isOpen: false,
});

function SelectDrawer({
  children,
  value,
  onValueChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  ...props
}: React.ComponentProps<typeof Select> & {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();

  // ✅ Hydration-safe viewport detection
  const hasMountedRef = React.useRef(false);
  const prevIsMobileRef = React.useRef(isMobile);
  const isViewportTransitionRef = React.useRef(false);

  React.useEffect(() => {
    hasMountedRef.current = true;
  }, []);

  // ✅ Viewport transition detection (only after mount)
  if (hasMountedRef.current && prevIsMobileRef.current !== isMobile && isOpen) {
    isViewportTransitionRef.current = true;
  }
  prevIsMobileRef.current = isMobile;

  // ✅ Reset transition flag after delay
  React.useEffect(() => {
    if (isViewportTransitionRef.current) {
      const timer = setTimeout(() => {
        isViewportTransitionRef.current = false;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isMobile]);

  // ✅ Controlled mode support
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  // ✅ Handle open change with transition guarding
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open && isViewportTransitionRef.current) {
        return;
      }
      if (!isControlled) {
        setInternalOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [isControlled, controlledOnOpenChange]
  );

  const close = React.useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  if (isMobile) {
    return (
      <SelectDrawerContext.Provider value={{ isMobile, value, onValueChange, close, isOpen }}>
        <Drawer open={isOpen} onOpenChange={handleOpenChange} {...props}>
          {children}
        </Drawer>
      </SelectDrawerContext.Provider>
    );
  }

  return (
    <SelectDrawerContext.Provider value={{ isMobile, value, onValueChange, close, isOpen }}>
      <Select
        value={value}
        onValueChange={onValueChange}
        open={isOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </Select>
    </SelectDrawerContext.Provider>
  );
}

// ✅ Add closeOnSelect support to SelectDrawerItem
function SelectDrawerItem({
  className,
  children,
  value,
  onSelect,
  closeOnSelect = true,  // NEW PROP
  ...props
}: React.ComponentProps<typeof SelectItem> & {
  onSelect?: () => void;
  closeOnSelect?: boolean;
}) {
  const { isMobile, value: selectedValue, onValueChange, close } = useSelectDrawerContext();

  if (isMobile) {
    const isSelected = value === selectedValue;

    const handleClick = () => {
      if (onValueChange && value) {
        onValueChange(value);
      }
      if (onSelect) {
        onSelect();
      }
      // Only close if closeOnSelect is true
      if (closeOnSelect) {
        close();
      }
    };

    // Don't wrap in DrawerClose if closeOnSelect is false
    const content = (
      <div className={cn("...", className)} onClick={handleClick} {...props}>
        <div className="flex-1">{children}</div>
        {isSelected && <CheckIcon className="size-4 text-primary" />}
      </div>
    );

    if (!closeOnSelect) {
      return content;
    }

    return <DrawerClose asChild>{content}</DrawerClose>;
  }

  return (
    <SelectItem className={className} value={value!} {...props}>
      {children}
    </SelectItem>
  );
}
```

**Migration Checklist for SelectDrawer**:

- [ ] Add `open` and `onOpenChange` props to SelectDrawer
- [ ] Add `hasMountedRef` for hydration-safe detection
- [ ] Add `isViewportTransitionRef` for transition guarding
- [ ] Add `close` and `isOpen` to context
- [ ] Add `closeOnSelect` prop to SelectDrawerItem
- [ ] Update context to include new values
- [ ] Test with all 8 existing usages:
  - [ ] `year-workspace-select.tsx`
  - [ ] `theme-section.tsx`
  - [ ] `language-section.tsx`
  - [ ] `seasonal-themes-section.tsx`
  - [ ] `grades/page.tsx`
  - [ ] `overview/page.tsx`

**Key Considerations for SelectDrawer**:
- Value state is already managed externally (via `value`/`onValueChange`)
- Open state needs to support both controlled and uncontrolled modes
- Radix Select has its own `open`/`onOpenChange` - need to wire up correctly
- Consider if search/filter functionality is needed in mobile drawer view

### Phase 3: Create ComboboxDrawer Component

**Implementation Plan**:

```tsx
// combobox-drawer.tsx
const ComboboxDrawer = ({
  options,
  value,
  onValueChange,
  searchable = true,
  reparentableContent,
}: ComboboxDrawerProps) => {
  const isMobile = useIsMobile();
  const stableHost = useStableHost();

  // ... viewport transition handling

  // Search input needs to survive mode switches
  const [search, setSearch] = useState("");
  const filteredOptions = useMemo(() => {
    if (!search) return options;
    return options.filter(opt =>
      opt.label.toLowerCase().includes(search.toLowerCase())
    );
  }, [options, search]);

  if (isMobile) {
    return (
      <Drawer>
        <DrawerContent>
          <Command>
            <CommandInput value={search} onValueChange={setSearch} />
            <CommandList>
              {filteredOptions.map(opt => (
                <CommandItem key={opt.value} onSelect={() => onValueChange(opt.value)}>
                  {opt.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover>
      <PopoverContent>
        <Command>
          {/* Same Command structure */}
        </Command>
      </PopoverContent>
    </Popover>
  );
};
```

### Phase 4: Create PopoverDrawer Component

**Implementation Plan**:

```tsx
// popover-drawer.tsx
const PopoverDrawer = ({
  children,
  content,
  open,
  onOpenChange,
}: PopoverDrawerProps) => {
  const isMobile = useIsMobile();

  // ... standard responsive wrapper pattern

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent>{content}</DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent>{content}</PopoverContent>
    </Popover>
  );
};
```

### Phase 5: Create Shared Responsive Utilities

**Goal**: Extract common patterns from DropDrawer, SelectDrawer, and Credenza into reusable hooks.

**Identified Patterns to Extract**:

| Pattern | Used In | Purpose |
|---------|---------|---------|
| Hydration-safe viewport | DropDrawer, Credenza, (SelectDrawer) | Prevent false transitions on hydration |
| Controlled/uncontrolled state | DropDrawer, Credenza, (SelectDrawer) | Support both modes |
| Viewport transition guarding | DropDrawer, Credenza, (SelectDrawer) | Ignore false close events |
| Stable DOM host | Credenza | Preserve React state across mode switches |
| Coordinated state | more-button.tsx pattern | Hide parent when child opens |

**Implementation**:

```tsx
// hooks/use-responsive-portal.ts

import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMediaQuery } from "@/components/ui/use-media-query";

/**
 * Hook for hydration-safe viewport detection with transition handling.
 * This is the core pattern used by all responsive portal components.
 *
 * @param open - Current open state of the portal
 * @param options - Configuration options
 * @returns Object with viewport state and handlers
 *
 * @example
 * ```tsx
 * function SelectDrawer({ open, onOpenChange }) {
 *   const { isMobile, handleOpenChange } = useResponsivePortal(open, {
 *     onOpenChange,
 *     transitionDuration: 500,
 *   });
 *
 *   if (isMobile) {
 *     return <Drawer open={open} onOpenChange={handleOpenChange}>...</Drawer>;
 *   }
 *   return <Select open={open} onOpenChange={handleOpenChange}>...</Select>;
 * }
 * ```
 */
export function useResponsivePortal(
  open: boolean,
  options: {
    onOpenChange?: (open: boolean) => void;
    transitionDuration?: number;
    useDesktopQuery?: boolean; // true = use (min-width: 768px), false = use useIsMobile
  } = {}
) {
  const { onOpenChange, transitionDuration = 500, useDesktopQuery = false } = options;

  // Support both useIsMobile and useMediaQuery patterns
  const isMobileHook = useIsMobile();
  const isDesktopQuery = useMediaQuery("(min-width: 768px)");
  const isMobile = useDesktopQuery ? !isDesktopQuery : isMobileHook;

  // Hydration-safe viewport detection
  const hasMountedRef = React.useRef(false);
  const prevIsMobileRef = React.useRef(isMobile);
  const isTransitioningRef = React.useRef(false);

  // Mark as mounted after first render
  React.useEffect(() => {
    hasMountedRef.current = true;
  }, []);

  // Detect viewport transitions (only after mount to skip hydration)
  if (hasMountedRef.current && prevIsMobileRef.current !== isMobile && open) {
    isTransitioningRef.current = true;
  }
  prevIsMobileRef.current = isMobile;

  // Reset transition flag after delay
  React.useEffect(() => {
    if (isTransitioningRef.current) {
      const timer = setTimeout(() => {
        isTransitioningRef.current = false;
      }, transitionDuration);
      return () => clearTimeout(timer);
    }
  }, [isMobile, transitionDuration]);

  // Handle open change with transition guarding
  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      // Ignore close events during viewport transitions
      if (!newOpen && isTransitioningRef.current) {
        return;
      }
      onOpenChange?.(newOpen);
    },
    [onOpenChange]
  );

  return {
    isMobile,
    isDesktop: !isMobile,
    isTransitioning: isTransitioningRef.current,
    handleOpenChange,
  };
}

/**
 * Hook for controlled/uncontrolled state pattern.
 * Allows components to work with or without external state control.
 *
 * @example
 * ```tsx
 * function SelectDrawer({ open: controlledOpen, onOpenChange }) {
 *   const { isOpen, setOpen, isControlled } = useControllableState({
 *     value: controlledOpen,
 *     onChange: onOpenChange,
 *     defaultValue: false,
 *   });
 *
 *   return <Drawer open={isOpen} onOpenChange={setOpen}>...</Drawer>;
 * }
 * ```
 */
export function useControllableState<T>({
  value: controlledValue,
  onChange,
  defaultValue,
}: {
  value?: T;
  onChange?: (value: T) => void;
  defaultValue: T;
}) {
  const [internalValue, setInternalValue] = React.useState<T>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const setValue = React.useCallback(
    (newValue: T) => {
      if (!isControlled) {
        setInternalValue(newValue);
      }
      onChange?.(newValue);
    },
    [isControlled, onChange]
  );

  return {
    value,
    setValue,
    isControlled,
  };
}

/**
 * Hook for creating stable DOM hosts for reparentable content.
 * Used by Credenza to preserve form state across Dialog↔Drawer switches.
 *
 * @param enabled - Whether to create the host (default: true)
 * @returns Stable HTMLDivElement or null
 */
export function useStableHost(enabled = true) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  if (enabled && hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "contents"; // Don't affect layout
    hostRef.current.setAttribute("data-stable-host", "true");

    // Prevent clicks from propagating to parent overlays
    hostRef.current.addEventListener("pointerdown", (e) => e.stopPropagation());
    hostRef.current.addEventListener("click", (e) => e.stopPropagation());
  }

  return enabled ? hostRef.current : null;
}

/**
 * Hook for coordinating parent-child portal state.
 * Used when opening a dialog from a dropdown - hides parent, shows child,
 * then re-shows parent when child closes.
 *
 * @example
 * ```tsx
 * function MoreButton() {
 *   const { parentOpen, setParentOpen, openChild, createChildHandler } =
 *     useCoordinatedPortals();
 *
 *   const [dialogOpen, handleDialogChange] = createChildHandler();
 *
 *   return (
 *     <>
 *       <Dialog open={dialogOpen} onOpenChange={handleDialogChange} />
 *       <DropDrawer open={parentOpen} onOpenChange={setParentOpen}>
 *         <DropDrawerItem onClick={() => openChild(() => setDialogOpen(true))}>
 *           Open Dialog
 *         </DropDrawerItem>
 *       </DropDrawer>
 *     </>
 *   );
 * }
 * ```
 */
export function useCoordinatedPortals() {
  const [parentOpen, setParentOpen] = React.useState(false);

  const openChild = React.useCallback((openChildFn: () => void) => {
    setParentOpen(false);
    openChildFn();
  }, []);

  const createChildHandler = React.useCallback(() => {
    const [childOpen, setChildOpen] = React.useState(false);

    const handleChildChange = React.useCallback((open: boolean) => {
      setChildOpen(open);
      if (!open) {
        setParentOpen(true);
      }
    }, []);

    return [childOpen, handleChildChange, setChildOpen] as const;
  }, []);

  return {
    parentOpen,
    setParentOpen,
    openChild,
    createChildHandler,
  };
}
```

**Refactoring Components to Use Shared Hooks**:

```tsx
// BEFORE: DropDrawer with inline implementation
function DropDrawer({ open, onOpenChange, children }) {
  const isMobile = useIsMobile();
  const hasMountedRef = React.useRef(false);
  const prevIsMobileRef = React.useRef(isMobile);
  const isViewportTransitionRef = React.useRef(false);
  // ... 30 lines of boilerplate
}

// AFTER: DropDrawer using shared hooks
function DropDrawer({ open: controlledOpen, onOpenChange, children }) {
  const { value: isOpen, setValue: setOpen } = useControllableState({
    value: controlledOpen,
    onChange: onOpenChange,
    defaultValue: false,
  });

  const { isMobile, handleOpenChange } = useResponsivePortal(isOpen, {
    onOpenChange: setOpen,
  });

  // ... much cleaner component logic
}
```

### Phase 6: Create Universal ResponsivePortal Component

**The ultimate goal - a single component that can render any portal-based UI**:

```tsx
// components/ui/responsive-portal.tsx

type PortalMode = 'dialog' | 'drawer' | 'dropdown' | 'popover' | 'select' | 'combobox';

interface ResponsivePortalProps {
  children: React.ReactNode;
  content: React.ReactNode;

  // Mode configuration
  desktopMode: PortalMode;
  mobileMode: PortalMode;

  // State
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  // For select/combobox
  value?: string;
  onValueChange?: (value: string) => void;
  options?: Array<{ value: string; label: string }>;

  // For state preservation
  reparentableContent?: React.ReactNode;

  // Customization
  desktopProps?: Record<string, unknown>;
  mobileProps?: Record<string, unknown>;
}

const ResponsivePortal = ({
  children,
  content,
  desktopMode,
  mobileMode,
  open,
  onOpenChange,
  reparentableContent,
  ...props
}: ResponsivePortalProps) => {
  const { isMobile, handleOpenChange } = useResponsivePortal(open ?? false);
  const stableHost = useStableHost(!!reparentableContent);

  const mode = isMobile ? mobileMode : desktopMode;

  const wrappedOnOpenChange = useCallback((newOpen: boolean) => {
    handleOpenChange(newOpen, onOpenChange);
  }, [handleOpenChange, onOpenChange]);

  // Render appropriate component based on mode
  switch (mode) {
    case 'dialog':
      return <DialogRenderer {...props} open={open} onOpenChange={wrappedOnOpenChange} />;
    case 'drawer':
      return <DrawerRenderer {...props} open={open} onOpenChange={wrappedOnOpenChange} />;
    case 'dropdown':
      return <DropdownRenderer {...props} open={open} onOpenChange={wrappedOnOpenChange} />;
    case 'popover':
      return <PopoverRenderer {...props} open={open} onOpenChange={wrappedOnOpenChange} />;
    case 'select':
      return <SelectRenderer {...props} open={open} onOpenChange={wrappedOnOpenChange} />;
    case 'combobox':
      return <ComboboxRenderer {...props} open={open} onOpenChange={wrappedOnOpenChange} />;
  }
};
```

---

## Universal Component Vision

### Architecture Goal

```
┌─────────────────────────────────────────────────────────────────┐
│                      ResponsivePortal                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Core Features                           │  │
│  │  • Viewport detection (hydration-safe)                    │  │
│  │  • Transition guarding                                     │  │
│  │  • State preservation (reparentable content)              │  │
│  │  • History stack management                                │  │
│  │  • Nested component coordination                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐       │
│  │  Dialog Mode    │ │ Drawer Mode │ │  Dropdown Mode  │       │
│  │  • Radix Dialog │ │ • Vaul      │ │  • Radix        │       │
│  │  • Centered     │ │ • Bottom    │ │  • Positioned   │       │
│  │  • Overlay      │ │ • Draggable │ │  • No overlay   │       │
│  └─────────────────┘ └─────────────┘ └─────────────────┘       │
│              │               │               │                  │
│              └───────────────┴───────────────┘                  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Content Renderers                       │  │
│  │  • Form content (with reset handling)                     │  │
│  │  • Menu items (with selection handling)                   │  │
│  │  • Search/filter (with keyboard navigation)               │  │
│  │  • Custom content                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Composition over Configuration**: Use compound components pattern
2. **Progressive Enhancement**: Work without JS, enhance with it
3. **Accessibility First**: All modes must be fully accessible
4. **Performance**: Lazy load mobile-specific code when possible
5. **Type Safety**: Full TypeScript support with discriminated unions

### API Design Goals

```tsx
// Simple usage - automatic mode selection
<ResponsivePortal>
  <ResponsivePortal.Trigger>Open</ResponsivePortal.Trigger>
  <ResponsivePortal.Content>
    <p>Content here</p>
  </ResponsivePortal.Content>
</ResponsivePortal>

// Explicit mode control
<ResponsivePortal desktopMode="popover" mobileMode="drawer">
  {/* ... */}
</ResponsivePortal>

// With state preservation
<ResponsivePortal
  reparentableContent={<MyForm />}
  desktopMode="dialog"
  mobileMode="drawer"
>
  <ResponsivePortal.Trigger>Edit</ResponsivePortal.Trigger>
  <ResponsivePortal.Content>
    <ResponsivePortal.Header>
      <ResponsivePortal.Title>Edit Item</ResponsivePortal.Title>
    </ResponsivePortal.Header>
    <ResponsivePortal.Body>
      <ResponsivePortal.FormSlot />
    </ResponsivePortal.Body>
  </ResponsivePortal.Content>
</ResponsivePortal>

// Select variant
<ResponsivePortal.Select
  value={value}
  onValueChange={setValue}
  options={options}
/>

// Combobox variant
<ResponsivePortal.Combobox
  value={value}
  onValueChange={setValue}
  options={options}
  searchable
  creatable
/>
```

### Migration Strategy

1. **Phase 1**: Create new components alongside existing ones
2. **Phase 2**: Migrate one component at a time, testing thoroughly
3. **Phase 3**: Deprecate old components
4. **Phase 4**: Remove old components after migration period

### Testing Requirements

For each responsive component:

1. **Unit Tests**:
   - State preservation across mode switches
   - Correct mode selection based on viewport
   - Proper cleanup on unmount

2. **Integration Tests**:
   - Nested component interactions
   - History stack management
   - Form submission and validation

3. **E2E Tests**:
   - Real viewport resizing
   - Touch interactions on mobile
   - Keyboard navigation
   - Screen reader compatibility

4. **Visual Regression Tests**:
   - Desktop appearance
   - Mobile appearance
   - Transition animations

---

## Appendix: Code Examples

### Example: Migrating an Existing Select

**Before** (non-responsive):
```tsx
<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Select..." />
  </SelectTrigger>
  <SelectContent>
    {options.map(opt => (
      <SelectItem key={opt.value} value={opt.value}>
        {opt.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**After** (responsive):
```tsx
<SelectDrawer value={value} onValueChange={setValue}>
  <SelectDrawerTrigger>
    <SelectDrawerValue placeholder="Select..." />
  </SelectDrawerTrigger>
  <SelectDrawerContent>
    {options.map(opt => (
      <SelectDrawerItem key={opt.value} value={opt.value}>
        {opt.label}
      </SelectDrawerItem>
    ))}
  </SelectDrawerContent>
</SelectDrawer>
```

### Example: Complex Form Dialog

```tsx
function EditUserDialog({ user, onSave }) {
  const [open, setOpen] = useState(false);

  return (
    <Credenza
      open={open}
      onOpenChange={setOpen}
      reparentableContent={
        <EditUserForm
          user={user}
          onSave={(data) => {
            onSave(data);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      }
    >
      <CredenzaTrigger asChild>
        <Button>Edit User</Button>
      </CredenzaTrigger>
      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>Edit User</CredenzaTitle>
          <CredenzaDescription>
            Update user information below.
          </CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody>
          <CredenzaFormSlot />
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
```

---

## Conclusion

This responsive dialog system provides a solid foundation for building a unified component library that works seamlessly across all device types. The key innovations are:

1. **Reparentable content** for state preservation
2. **Hydration-safe viewport detection** to prevent false transitions
3. **Coordinated state management** for nested components
4. **Mobile back gesture interception** for native-feeling UX

By following this architecture and expanding to other component types, we can create a best-in-class responsive UI system that rivals native mobile apps while maintaining the flexibility of web development.

---

## Immediate Next Steps

### Priority 1: Refactor SelectDrawer (Estimated: 1-2 hours)

```bash
# Files to modify:
apps/client/src/components/ui/selectdrawer.tsx
```

**Changes Required**:
1. Add controlled mode (`open`/`onOpenChange` props)
2. Add hydration-safe viewport detection (`hasMountedRef` pattern)
3. Add viewport transition guarding (`isViewportTransitionRef` pattern)
4. Add `close` and `isOpen` to context
5. Add `closeOnSelect` prop to `SelectDrawerItem`

**Testing**: Verify all 8 existing usages still work correctly.

### Priority 2: Extract Shared Hooks (Estimated: 2-3 hours)

```bash
# File to create:
apps/client/src/hooks/use-responsive-portal.ts
```

**Hooks to Create**:
- `useResponsivePortal` - Hydration-safe viewport detection
- `useControllableState` - Controlled/uncontrolled pattern
- `useStableHost` - Reparentable content DOM host
- `useCoordinatedPortals` - Parent-child state coordination

### Priority 3: Refactor Existing Components to Use Hooks (Estimated: 2-3 hours)

Update these components to use the shared hooks:
1. `DropDrawer` - Replace inline implementation with `useResponsivePortal`
2. `Credenza` - Replace inline implementation with `useResponsivePortal` + `useStableHost`
3. `SelectDrawer` - Use all applicable hooks

### Priority 4: Create New Responsive Components (Estimated: 4-6 hours each)

Order by usage frequency in the codebase:
1. **ComboboxDrawer** - For searchable select components
2. **PopoverDrawer** - For popovers that should become drawers on mobile
3. **AlertDialogDrawer** - For confirmations/alerts

### Priority 5: Universal ResponsivePortal (Estimated: 8-12 hours)

Create the unified component after all patterns are validated:
- Single API for all responsive portal needs
- Compound component pattern
- Full TypeScript support
- Comprehensive test coverage

---

## Related Files Reference

### Core UI Components
- `apps/client/src/components/ui/credenza.tsx` - Dialog/Drawer with state preservation
- `apps/client/src/components/ui/dropdrawer.tsx` - Dropdown/Drawer with full features
- `apps/client/src/components/ui/selectdrawer.tsx` - Select/Drawer (needs refactoring)
- `apps/client/src/components/ui/drawer.tsx` - Enhanced Vaul drawer with back gesture

### Dialog Components Using Credenza
- `apps/client/src/components/dialogs/add-subject-dialog.tsx`
- `apps/client/src/components/dialogs/add-grade-dialog.tsx`
- `apps/client/src/components/dialogs/add-period-dialog.tsx`
- `apps/client/src/components/dialogs/update-*.tsx`
- `apps/client/src/components/dialogs/delete-*.tsx`

### Example Usage Patterns
- `apps/client/src/components/buttons/dashboard/more-button.tsx` - Coordinated state pattern
- `apps/client/src/components/selects/year-workspace-select.tsx` - SelectDrawer usage
- `apps/client/src/components/buttons/dashboard/subject/subject-more-button.tsx` - DropDrawer with dialogs

### Hooks
- `apps/client/src/hooks/use-mobile.ts` - Mobile detection hook
- `apps/client/src/components/ui/use-media-query.tsx` - Media query hook
