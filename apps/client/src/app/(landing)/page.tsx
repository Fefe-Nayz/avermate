"use client";
import { Benefits } from "@/components/landing/benefits";
import { CTA } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { Headline } from "@/components/landing/headline";
import { Product } from "@/components/landing/product";
import { SocialProof } from "@/components/landing/social-proof";
import Aurora from "@/components/landing/aurora";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function LandingPage() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dark = resolvedTheme === "dark";

  return (
    <div className="relative">
      {mounted && (
      <motion.div
        className="absolute top-0 left-0 w-full h-[100vh] z-0 pointer-events-none overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 1, ease: "easeInOut" }}
      >
        <Aurora
          dark={dark}
          colorStops={
            dark
              ? ["#4338CA", "#059669", "#7C3AED"]
              : ["#BEE3FF", "#D9FFB5", "#EBD3FF"]
          }
          speed={0.8}
          blend={dark ? 0.4 : 0.6}
          amplitude={dark ? 1.2 : 1.0}
          edgeLift={1.0}
          bgColor={[1, 1, 1]}
          minWidth={1200}
          minHeight={800}
        />
      </motion.div>
      )}
      <div className="relative z-10">
        <Headline />

        <SocialProof />

        <section id="benefits">
          <Benefits />
        </section>

        <section id="features">
          <Product />
        </section>

        <section id="faq" className="pb-64">
          <CTA />

          <FAQ />
        </section>
      </div>
    </div>
  );
}
