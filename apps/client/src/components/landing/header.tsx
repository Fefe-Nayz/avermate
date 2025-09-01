"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import Logo from "../logo";
import { GetStarted } from "./get-started";

export const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeLink, setActiveLink] = useState(0);

  const [linkWidths, setLinkWidths] = useState<number[]>([]);
  const [linkPositions, setLinkPositions] = useState<number[]>([]);
  const linkRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Run the initial #hash scroll only once
  const didRunInitialHashScroll = useRef(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    setIsScrolled(window.scrollY > 20); // initial
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Keep links stable across renders
  const links = useMemo(
    () => [
      { to: "/", label: "Home" },
      { to: "#benefits", label: "Benefits" },
      { to: "#features", label: "Features" },
      { to: "#faq", label: "FAQ" },
    ],
    []
  );

  // User-initiated navigation handler
  const handleNavClick = (to: string, index: number) => {
    setActiveLink(index);

    if (to.startsWith("#")) {
      // Update URL hash and smooth scroll — user intent
      window.history.pushState(null, "", to);
      const element = document.querySelector(to);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (to === "/") {
      // Clear hash (Home) and smooth scroll top — user intent
      window.history.pushState(null, "", window.location.pathname);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    // Other routes: <Link> handles it
  };

  // Initial page load: respect existing hash exactly once
  useEffect(() => {
    if (didRunInitialHashScroll.current) return;
    didRunInitialHashScroll.current = true;

    const hash = window.location.hash;
    if (hash) {
      const linkIndex = links.findIndex((l) => l.to === hash);
      if (linkIndex !== -1) {
        setActiveLink(linkIndex);
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    } else {
      setActiveLink(0);
    }
  }, [links]);

  // Intersection Observer: only update highlight (NO hash change, NO scroll)
  useEffect(() => {
    const sections = links
      .map((l) => (l.to.startsWith("#") ? l.to : null))
      .filter((s): s is string => !!s);

    const elements = sections
      .map((sel) => document.querySelector(sel))
      .filter((el): el is Element => !!el);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const sectionId = `#${entry.target.id}`;
          const linkIndex = links.findIndex((l) => l.to === sectionId);
          if (linkIndex !== -1) {
            // Only aesthetic selection; do not modify history or scroll
            setActiveLink(linkIndex);
          }
        });
      },
      {
        threshold: 0.3,
        rootMargin: "-80px 0px -50% 0px",
      }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [links]);

  // Also set initial highlight based on current scroll position (aesthetic only)
  useEffect(() => {
    const sections = links
      .map((l) => (l.to.startsWith("#") ? l.to : null))
      .filter((s): s is string => !!s);
    const elements = sections
      .map((sel) => document.querySelector(sel))
      .filter((el): el is HTMLElement => !!el) as HTMLElement[];

    const setInitialActiveSection = () => {
      const scrollPosition = window.scrollY + 100;

      if (scrollPosition < 200) {
        setActiveLink(0);
        return;
      }
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el && el.offsetTop <= scrollPosition) {
          const id = `#${el.id}`;
          const idx = links.findIndex((l) => l.to === id);
          if (idx !== -1) {
            setActiveLink(idx); // aesthetic only
            break;
          }
        }
      }
    };

    setInitialActiveSection();
  }, [links]);

  // Measure link widths/positions; recalc on resize and when links render
  useEffect(() => {
    const recalc = () => {
      const widths: number[] = [];
      const positions: number[] = [];
      let current = 8; // left padding offset

      linkRefs.current.forEach((ref, i) => {
        const w = ref?.offsetWidth ?? 0;
        widths[i] = w;
        positions[i] = current;
        current += w;
      });

      setLinkWidths(widths);
      setLinkPositions(positions);
    };

    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  return (
    <header
      className={`fixed z-50 flex justify-center transition-all duration-500 ease-in-out w-full ${isScrolled ? "mx-4 md:mx-0 top-6" : "md:mx-0 top-4 mx-0"
        }`}
    >
      <motion.div
        animate={{ width: isScrolled ? "800px" : "70rem" }}
        initial={{ width: "70rem" }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div
          className={`mx-auto max-w-7xl rounded-2xl transition-all duration-500 ease-in-out xl:px-0 ${isScrolled
              ? "px-2 border border-border backdrop-blur-lg bg-background/20"
              : "px-7 shadow-none"
            }`}
        >
          <div className="flex h-[56px] items-center justify-between p-4">
            <Link href="/" className="flex items-center gap-3">
              <Logo />
            </Link>

            <div className="w-full hidden md:block">
              <ul className="relative mx-auto flex w-fit rounded-full h-11 px-2 items-center justify-center">
                {links.map(({ to, label }, index) => (
                  <li
                    key={to}
                    ref={(el) => {
                      linkRefs.current[index] = el;
                    }}
                    className="z-10 cursor-pointer h-full flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors duration-200 text-primary/60 hover:text-primary tracking-tight"
                    onClick={(e) => {
                      // Prevent default behavior for hash links; handle manually
                      if (to.startsWith("#")) e.preventDefault();
                      handleNavClick(to, index);
                    }}
                  >
                    {to.startsWith("#") ? (
                      <span>{label}</span>
                    ) : (
                      <Link href={to}>{label}</Link>
                    )}
                  </li>
                ))}

                <motion.li
                  className="absolute inset-0 my-1.5 rounded-full bg-accent/60 border border-border"
                  animate={{
                    left: linkPositions[activeLink] ?? 8,
                    width: linkWidths[activeLink] ?? 68.86666870117188,
                  }}
                  transition={{ damping: 30, stiffness: 400, type: "spring" }}
                />
              </ul>
            </div>

            <div className="flex flex-row items-center gap-1 md:gap-3 shrink-0">
              <GetStarted />
            </div>
          </div>
        </div>
      </motion.div>
    </header>
  );
};
