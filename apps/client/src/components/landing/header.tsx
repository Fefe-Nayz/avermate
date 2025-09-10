"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import Logo from "../logo";
import { GetStarted } from "./get-started";
import ThemeToggleButton from "../ui/theme-toggle-button";

const SECTION_IDS = [
  { id: "home", href: "/" }, // sentinel
  { id: "benefits", href: "#benefits" },
  { id: "features", href: "#features" },
  { id: "faq", href: "#faq" },
] as const;

export { SECTION_IDS };

/* --------------------------------------------------------------------------
   𝗨𝘀𝗲𝗿 𝗴𝗼𝘁 𝗮 𝗺𝗮𝘅𝗶𝗺𝘂𝗺-𝗱𝗲𝗽𝘁𝗵 𝗲𝗿𝗿𝗼𝗿 + 𝗽𝗶𝗹𝗹 𝗻𝗼𝘁 𝘁𝗿𝗮𝗰𝗸𝗶𝗻𝗴.
   We ditched the Fumadocs hook in favour of a purpose‑built, *minimal* hook that
   cannot recurse and that closely mirrors the blog‑post algorithm the user sent.
   -------------------------------------------------------------------------- */

/* ─────────────────────────────── Section observer ─────────────────────────────── */

/**
 * Observe the sentinels for each section and return the currently visible id.
 * @param ids  Array of sentinel element ids **in the same order they appear**.
 * @param freeze  When true the observer will keep the current id frozen.
 */
function useSectionObserver(ids: string[], freeze: boolean): string {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? "");
  const entriesRef = useRef<Record<string, IntersectionObserverEntry>>({});
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const freezeRef = useRef(freeze);
  freezeRef.current = freeze;

  const recomputeActive = () => {
    const getIndex = (id: string) => idsRef.current.findIndex((x) => x === id);
    const visibleIds = idsRef.current.filter(
      (id) => entriesRef.current[id]?.isIntersecting,
    );

    if (visibleIds.length === 1) setActiveId(visibleIds[0]);
    else if (visibleIds.length > 1) {
      visibleIds.sort((a, b) => getIndex(a) - getIndex(b));
      setActiveId(visibleIds[0]);
    } else {
      const { scrollY } = window;
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      if (scrollY <= 0) setActiveId(idsRef.current[0]);
      else if (scrollY >= maxScroll - 6) setActiveId(idsRef.current.at(-1)!);
    }
  };

  useEffect(() => {
    const callback: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        entriesRef.current[entry.target.id] = entry;
      });
      if (!freezeRef.current) recomputeActive();
    };

    const observer = new IntersectionObserver(callback, {
      rootMargin: "-80px 0px -40% 0px",
      threshold: 0,
    });

    idsRef.current
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el)
      .forEach((el) => observer.observe(el));

    callback([] as unknown as IntersectionObserverEntry[], observer); // initial
    return () => observer.disconnect();
  }, []);

  // When freeze toggles off, recompute once.
  useEffect(() => {
    if (!freeze) {
      freezeRef.current = false;
      recomputeActive();
    } else {
      freezeRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze]);

  return activeId;
}

/* ─────────────────────────────── Header component ─────────────────────────────── */

export const Header = () => {
  const t = useTranslations("Landing.Header");

  // Create sections with localized labels
  const SECTIONS = useMemo(() => [
    { id: "home", label: t("home"), href: "/" },
    { id: "benefits", label: t("benefits"), href: "#benefits" },
    { id: "features", label: t("features"), href: "#features" },
    { id: "faq", label: t("faq"), href: "#faq" },
  ], [t]);

  /* Shadow / size on scroll ---------------------------------------------------- */
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Active link logic ---------------------------------------------------------- */
  const ids = useMemo(() => SECTIONS.map((s) => s.id) as string[], [SECTIONS]);

  // During programmatic scroll we freeze the observer & force a manual id.
  const [isNavScrolling, setIsNavScrolling] = useState(false);
  const [manualId, setManualId] = useState<string | null>(null);

  const observedId = useSectionObserver(ids, isNavScrolling);
  const activeId = manualId ?? observedId;
  const activeIndex = useMemo(() => ids.indexOf(activeId), [ids, activeId]);

  /* Link measurements for animated pill --------------------------------------- */
  const linkRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [linkRects, setLinkRects] = useState<{ x: number; w: number }[]>([]);

  useEffect(() => {
    const measure = () => {
      let x = 8;
      const rects = linkRefs.current.map((el) => {
        const w = el?.offsetWidth ?? 0;
        const r = { x, w };
        x += w;
        return r;
      });
      setLinkRects(rects);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /* Smooth‑scroll navigation --------------------------------------------------- */
  const handleNavClick = (href: string) => {
    const id = href.startsWith("#") ? href.slice(1) : ids[0];

    setManualId(id); // override observer highlight immediately
    setIsNavScrolling(true);

    const finish = () => setIsNavScrolling(false);

    if (href.startsWith("#")) {
      history.pushState(null, "", href);
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      history.pushState(null, "", location.pathname);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // Hard‑coded duration fallback (can't reliably detect end of scroll)
    setTimeout(finish, 700);
  };

  useEffect(() => {
    // Once scrolling has stopped *and* the observer now agrees with the
    // manual id, we can drop the manual override without a visible jump.
    if (!isNavScrolling && manualId && observedId === manualId) {
      setManualId(null);
    }
  }, [isNavScrolling, observedId, manualId]);

  /* ---------------------------------- Render --------------------------------- */
  return (
    <motion.header
      layoutRoot
      className="fixed inset-x-0 z-50 flex justify-center px-4 md:px-0"
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <motion.div
        animate={{
          width: isMobile ? "100%" : isScrolled ? "50rem" : "70rem"
        }}
        initial={{
          width: isMobile ? "100%" : "70rem"
        }}
        transition={{ duration: isMobile ? 0 : 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        className={`${isScrolled ? "mt-6 mx-6" : "mt-4 mx-6"} ${isMobile ? "mx-4" : ""}`}
      >
        <div
          className={`mx-auto rounded-2xl xl:px-0 transition-all duration-500 w-full box-border ${isScrolled
            ? "border border-border bg-background/20 backdrop-blur-lg px-2"
            : "border border-transparent shadow-none"}`}
        >
          <div className="flex h-14 items-center justify-between p-4">
            {/* Logo */}


            <Logo />


            {/* Desktop nav */}
            <nav className="hidden md:block flex-1">
              <ul className="relative mx-auto flex h-11 w-fit items-center rounded-full px-2">
                {SECTIONS.map((s, i) => (
                  <li
                    key={s.id}
                    ref={el => { linkRefs.current[i] = el; }}
                    className="z-10 flex h-full cursor-pointer items-center justify-center px-4 py-2 text-sm font-medium tracking-tight text-primary/60 transition-colors hover:text-primary"
                    onClick={(e) => {
                      if (s.href.startsWith("#")) e.preventDefault();
                      handleNavClick(s.href);
                    }}
                  >
                    {s.href.startsWith("#") ? <span>{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
                  </li>
                ))}

                {/* Active pill */}
                <motion.li
                  className="absolute inset-0 my-1.5 rounded-full border border-border bg-accent/60"
                  animate={{
                    left: linkRects[activeIndex]?.x ?? 8,
                    width: linkRects[activeIndex]?.w ?? 68,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              </ul>
            </nav>

            {/* RHS buttons */}
            <div className="shrink-0 flex items-center gap-3">
              <div className="flex items-center space-x-6">
                <GetStarted headerStyle={true} />
              </div>
              <ThemeToggleButton />
            </div>
          </div>
        </div>
      </motion.div>
    </motion.header>
  );
};
