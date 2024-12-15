import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";
import { Session, User } from "better-auth/types";
import { ArrowRight, ShareIcon, SquarePlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function WelcomeScreen() {
  const { data: session } = authClient.useSession() as unknown as {
    data: { session: Session; user: User };
  };

  // -- Detect iOS (iPhone) --
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // Basic detection: check if user agent has 'iPhone'
    const userAgent = window.navigator.userAgent.toLowerCase();
    const onIphone = /iphone/.test(userAgent);
    setIsIos(onIphone);
  }, []);

  // -- PWA install logic (mostly for Android/Chrome) --
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallPrompt(e); // store the event
      setCanInstall(true); // show the button
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);

  // Listen for a successful install
  useEffect(() => {
    function handleAppInstalled() {
      disableInAppInstallPrompt();
    }

    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    const result = await (installPrompt as any).prompt();
    console.log(`Install prompt outcome: ${result.outcome}`);
    disableInAppInstallPrompt();
  };

  function disableInAppInstallPrompt() {
    setInstallPrompt(null);
    setCanInstall(false);
  }
  // -- end PWA install logic --

  return (
    <div className="text-center space-y-8">
      {/* Optional fancy icons */}
      {/* 
      <div className="relative inline-block">
        <Rocket className="w-24 h-24 mx-auto text-primary" />
        <Sparkles className="w-8 h-8 text-yellow-400 absolute top-0 right-0 animate-pulse" />
      </div> 
      */}

      <h2 className="text-4xl font-bold text-primary">
        Bienvenue sur Avermate,&nbsp;
        <span className="items-center">
          {session?.user?.name ? (
            session.user.name.split(" ")[0]
          ) : (
            <Skeleton className="w-32 h-11 inline-block align-middle" />
          )}
        </span>
        &nbsp;! 🎉
      </h2>

      <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
        Nous sommes ravis de vous accueillir à bord. Préparez-vous à décoller
        vers une expérience exceptionnelle !
      </p>

      <div className="bg-secondary/50 rounded-lg p-6 max-w-xl mx-auto space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Ce qui vous attend :</h3>
          <ul className="text-left text-muted-foreground space-y-2">
            <li className="flex items-center">
              <ArrowRight className="w-5 h-5 mr-2 text-primary" />
              Création de vos périodes
            </li>
            <li className="flex items-center">
              <ArrowRight className="w-5 h-5 mr-2 text-primary" />
              Création de vos matières
            </li>
            <li className="flex items-center">
              <ArrowRight className="w-5 h-5 mr-2 text-primary" />
              Ajout de vos premières notes
            </li>
          </ul>
        </div>

        {/* If canInstall is true (Android/Chrome), show the install button */}
        {canInstall && (
          <div className="flex flex-col md:flex-row items-center justify-center space-x-4">
            <p className="text-muted-foreground">
              Installer l&apos;application pour un accès rapide
            </p>
            <Button variant="default" onClick={handleInstallClick}>
              Installer l&apos;application
            </Button>
          </div>
        )}

        {/* If not installable (no beforeinstallprompt) but on iPhone, show iOS instructions */}
        {!canInstall && isIos && (
          <div className="text-left bg-secondary p-4 rounded-lg">
            <h4 className="text-lg font-semibold mb-2">Installer sur iPhone</h4>
            <p className="text-muted-foreground mb-2">
              Pour installer Avermate sur votre iPhone :
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-1">
              <li>Ouvrez Avermate dans Safari.</li>
              <li>
                Touchez l&apos;icône <strong>Partager</strong>{" "}
                <ShareIcon className="inline-block w-4 h-4 ml-1 align-text-bottom" />{" "}
                en bas de l&apos;écran.
              </li>
              <li>
                Sélectionnez{" "}
                <strong>Ajouter à l&apos;écran d&apos;accueil</strong>{" "}
                <SquarePlusIcon className="inline-block w-4 h-4 ml-1 align-text-bottom" />
                .
              </li>
              <li>
                Appuyez sur <strong>Ajouter</strong> pour confirmer.
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
