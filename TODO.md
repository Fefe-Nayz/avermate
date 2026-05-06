- Fix regression, keep dialog/sheet open when screen size changes
- Refactor the settings layout, first greeted with a settings section list on mobile with a search bar and then can navigate in the category. on pc, the categories are on the right and the general tab is selected by default 
- Refactor the settings cards to use the same unified card component
- Refactor the loading state of every component to be in a separated component
- Re-order the codebase/component directory/file structure
- Migrate to the sidebar/breadcumb header style on pc instead of the navbar
- Restyle and re-factor the overview page
- Add simple custom cards, cards customization, ordering, visibility controls, etc.
- Add a new theme feature where user can create there theme or select from the presets
- Refactor the preset subjects feature to track who is using what and be able to perform upadates on presets
- Move the local storage saved settings to the database (theme, langiage, chart settings, seasonal themes, card layouts)
- Add umami analytics for better tracking of user behavior and engagement with an admin panel to manage things like users, analytics, etc.
- Move to dockploy for ci cd
- Add OTP for email verification and restyle the auth pages
- Add a notifications feature

Refactor the major most messed up components and refactor how we fetch and treat the data
Faire le système d'amis/de classe

Il faudrait que tu ajoutes une feature "note composite" qui est en gros une note qui est composé de plusieurs sous notes. Il ne faut pas modifier le flux de création de note pour cela, il faudrait juste dans la page détail d'une note ajouter un bouton du style, transformer en note composite ou ajouter une sous note (en fait cela permettrait de faire la moyenne pondérée de toutes les sous note dans la note prinicipale et la note principale est le résultat de cette moyenne pondérée. Il faut vraiment un affichage sympa et utile comme les autres featuers pour gérer cela (peut être un tableau comme dans les détails de matière etc).
Aussi quand on a 0 de moyenne dans une matière, dans le tableau des notes on affiche un tiret mais on doit afficher 0 (ne pas interférer avec les autres cas où c'est justifié).
Ajouter un toggle qui permet de contrôler l'affichage ou non des sous matières dans le graphique de l'évolution de la moyenne en fonction du temps dans la page détail de matière.
Il y a un bug un peu pénible, quand on clique sur le bouton retour depuis une page détail de note/matière pour retrourner dans le tableu des notes, on est redirigé vers la partie du tableau où on était avant mais ce qui est pénible c'est qu'on est pas scroll instantanément mais avec un smooth scroll. On veut garder le smooth scroll global mais pas dans ce cas de figure.
Dans le tableau des notes, le nom des matières/moyennes et souligné en pointillés mais vu que les bords sont arrondis pour le select de l'accessibilité, le souligné est arrondi sur les bords, on ne veut pas cela. Aussi dans le tableau des notes dans la page de détail de moyenne, le nom de la note doit aussi avoir un effet foccued pour le tab select dans le même style shadcn qu'ailleurs.
Dans la page paramètre de l'année sur mobile, en dessous du titre, il y a un gros gap (à cause du div wrapper du h1 du pc qui est pas hidden correctement).
Dans tout le site tout les inputs d'email devrait avoir l'input type email pour l'html.
La notification pour le récap est buggé (la condition d'affichage). On dirait que dans tout les nouveaux appareils ça s'affiche tout le temps. Alors que nous on veut seulement afficher en fin d'année calendaire et scolaire (celle définie par le user) Et seulement si le recap n'a pas déjà été cliqué pour ce recap de l'année concernée. Cela devrair être save en DB. Aussi sur mobile quand la navbar se hide la position de la notif doit être ajustée.
On doit ajouter un système de notification/banière d'infos qu'on peut trigger/envoyer dans un panel admin et dismissable par les user et save en db (avec la liste des viewed en DB)
Il serait bien de pouvoir ajouter une feature pour pouvoir customiser les datacards de la page d'acceuil, lesquelles sont affichées, dans quel ordre, avec de la customisation et d'autres cards disponibles dans une liste et chacune customisable d'une façon propre à la card et bien sur persisté en DB. C'est une feature complexe que je veux faire depuis longtement pas jamais réussi, fait attention à que ça fonctionne bien sur mobile aussi.
Ca serait génial de pouvoir ajouter une feature de thème personnalisé où les utilisateurs peuvent créer leur propre thème ou sélectionner parmi les préréglages. Cela inclurait la possibilité de choisir des couleurs, des polices et d'autres éléments de design pour personnaliser l'apparence de l'application selon leurs préférences. Pour un composant de personalisation il y en a super dans https://github.com/shadcnstudio/shadcn-studio https://github.com/shadcnstudio/shadcn-studio/blob/main/src/components/customizer/ThemeControlPanel.tsx



Mettre à jour les dépendances et shadcnui
Migrer vers coss ui pour les dialogues/menus: https://coss.com/ui/docs/components/drawer -> vérifier si forms fonctionnent correctement et voir pour un système pour préserver le state du dislog/menu ainsi que son état d'ouverture quand on change de taille d'écran (mobile/desktop)
Il y a un bug très pénible avec le clavier virtuels sur mobile dans les formulaires dans les bottom sheet/drawer. en fait ça marche très mal sur chrome et firefox mobile. (le contenu de la sheet qui shift vers le haut de façon très buggé pas facilement explicable) -> migration coss ui ou silkhq