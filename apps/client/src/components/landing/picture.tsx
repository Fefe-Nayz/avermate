import { LandingSection } from "./landing-section";

export const Picture = () => {
  return (
    <LandingSection>
      <div className="flex flex-col gap-16 items-center">
        <div className="relative w-full">
          {/* Desktop Dark Theme */}
          <img
            src="/images/landing/main-desktop-dark.png"
            alt="Dashboard Desktop Dark"
            className="hidden dark-desktop:block w-full rounded-3xl max-w-[2000px] mask-[linear-gradient(to_top,transparent_10%,#000_100%)]"
          />

          {/* Desktop Light Theme */}
          <img
            src="/images/landing/main-desktop-light.png"
            alt="Dashboard Desktop Light"
            className="hidden light-desktop:block dark:hidden w-full rounded-3xl max-w-[2000px] mask-[linear-gradient(to_top,transparent_10%,#000_100%)]"
          />

          {/* Mobile Dark Theme */}
          <img
            src="/images/landing/main-mobile-dark.png"
            alt="Dashboard Mobile Dark"
            className="hidden dark-mobile:block w-full rounded-3xl max-w-[2000px] shadow-lg"
          />

          {/* Mobile Light Theme */}
          <img
            src="/images/landing/main-mobile-light.png"
            alt="Dashboard Mobile Light"
            className="hidden light-mobile:block dark:hidden w-full rounded-3xl max-w-[2000px] shadow-lg"
          />
        </div>
      </div>
    </LandingSection>
  );
};
