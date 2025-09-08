"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeftIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import * as React from "react";

import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const SelectDrawerContext = React.createContext<{
    isMobile: boolean;
    value?: string;
    onValueChange?: (value: string) => void;
}>({
    isMobile: false,
});

const useSelectDrawerContext = () => {
    const context = React.useContext(SelectDrawerContext);
    if (!context) {
        throw new Error(
            "SelectDrawer components cannot be rendered outside the SelectDrawer Context"
        );
    }
    return context;
};

function SelectDrawer({
    children,
    value,
    onValueChange,
    ...props
}: React.ComponentProps<typeof Select> & {
    children: React.ReactNode;
}) {
    const isMobile = useIsMobile();

    if (isMobile) {
        return (
            <SelectDrawerContext.Provider value={{ isMobile, value, onValueChange }}>
                <Drawer {...props}>
                    {children}
                </Drawer>
            </SelectDrawerContext.Provider>
        );
    }

    return (
        <SelectDrawerContext.Provider value={{ isMobile, value, onValueChange }}>
            <Select value={value} onValueChange={onValueChange} {...props}>
                {children}
            </Select>
        </SelectDrawerContext.Provider>
    );
}

function SelectDrawerTrigger({
    className,
    children,
    placeholder,
    ...props
}: (React.ComponentProps<typeof SelectTrigger> | React.ComponentProps<"div">) & {
    placeholder?: string;
}) {
    const { isMobile } = useSelectDrawerContext();

    if (isMobile) {
        return (
            <DrawerTrigger asChild>
                <div className={cn(
                    // Apply the same styling as SelectTrigger
                    "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                    className
                )}>
                    <span className="flex-1">{children}</span>
                    <ChevronDownIcon className="size-4 opacity-50" />
                </div>
            </DrawerTrigger>
        );
    }

    // For desktop, use the native SelectTrigger which already includes the chevron
    return (
        <SelectTrigger className={className} {...(props as React.ComponentProps<typeof SelectTrigger>)}>
            <SelectValue placeholder={placeholder}>
                {children}
            </SelectValue>
        </SelectTrigger>
    );
}

function SelectDrawerContent({
    className,
    children,
    title = "Select an option",
    ...props
}: React.ComponentProps<typeof SelectContent> & {
    title?: string;
}) {
    const { isMobile } = useSelectDrawerContext();

    if (isMobile) {
        return (
            <DrawerContent className={cn("max-h-[90vh]", className)} {...props}>
                <DrawerHeader>
                    <DrawerTitle>{title}</DrawerTitle>
                </DrawerHeader>
                <div className="overflow-y-auto max-h-[70vh] pb-6">
                    {children}
                </div>
            </DrawerContent>
        );
    }

    return (
        <SelectContent className={className} {...props}>
            {children}
        </SelectContent>
    );
}

function SelectDrawerItem({
    className,
    children,
    value,
    onSelect,
    ...props
}: React.ComponentProps<typeof SelectItem> & {
    onSelect?: () => void;
}) {
    const { isMobile, value: selectedValue, onValueChange } = useSelectDrawerContext();

    if (isMobile) {
        const isSelected = value === selectedValue;

        const handleClick = () => {
            if (onValueChange && value) {
                onValueChange(value);
            }
            if (onSelect) {
                onSelect();
            }
        };

        return (
            <DrawerClose asChild>
                <div
                    className={cn(
                        "flex cursor-pointer items-center justify-between px-4 py-3 transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent/50",
                        className
                    )}
                    onClick={handleClick}
                    {...props}
                >
                    <div className="flex-1">{children}</div>
                    {isSelected && (
                        <CheckIcon className="size-4 text-primary" />
                    )}
                </div>
            </DrawerClose>
        );
    }

    return (
        <SelectItem className={className} value={value!} {...props}>
            {children}
        </SelectItem>
    );
}

function SelectDrawerGroup({
    className,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    children: React.ReactNode;
}) {
    const { isMobile } = useSelectDrawerContext();

    if (isMobile) {
        return (
            <div
                className={cn(
                    "bg-accent/30 mx-3 my-2 overflow-hidden rounded-xl",
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }

    // On desktop, just render children without grouping
    return <>{children}</>;
}

function SelectDrawerSeparator({
    className,
    ...props
}: React.ComponentProps<"div">) {
    const { isMobile } = useSelectDrawerContext();

    if (isMobile) {
        return (
            <div
                className={cn("h-2", className)}
                {...props}
            />
        );
    }

    // No separator on desktop select
    return null;
}

export {
    SelectDrawer,
    SelectDrawerContent,
    SelectDrawerGroup,
    SelectDrawerItem,
    SelectDrawerSeparator,
    SelectDrawerTrigger,
};
