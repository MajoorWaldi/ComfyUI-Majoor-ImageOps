# ImageOps — correctifs compositing et fiabilité du live preview

**Audit de référence :** `main` à `7a1ecafc3b6d9c303b50fd8df3c60a5bfd751fa6`, 27 septembre 2026.  
**Statut :** plan de patch, aucun correctif de code appliqué par ce document.  
**Objectif :** faire correspondre l’aperçu interactif aux résultats calculés, préserver les workflows enregistrés et expliciter la temporalité image/vidéo/audio.

## Contrats transversaux

1. Une sélection temporelle est une liste d’indices source en ordre de lecture ; images, audio, métadonnées et live preview utilisent cette même liste.
2. Un clip vidéo garde une cadence explicite. `IMAGE` seul ne transporte pas de FPS : afficher l’hypothèse de 24 fps dans l’UI et permettre une cadence cible explicite.
3. `Live proxy` indique un calcul navigateur à résolution réduite. `Backend result` indique une sortie de queue. `Unsupported` et `Error` ne sont jamais présentés comme un résultat valide.
4. Le compositing travaille avec l’alpha et les valeurs HDR sans clamp implicite. La conversion pour l’affichage navigateur se fait à la fin de la chaîne de preview.
5. Conserver les identifiants de nodes, noms d’inputs/outputs et valeurs par défaut existantes, sauf changement de comportement explicitement documenté et testé.

## P0-A — Même trim pour images, audio et preview

**État :** `nodes/append.py::_trim_clip` échange `start` et `end` lorsque la plage est inversée. `nodes/frame_range.py::_timeline_indices` renvoie `[]` pour la même plage. `Append` utilise le premier pour les frames et le second pour l’audio.

**Patch backend :** déplacer la sélection dans `nodes/core/timeline.py` ; une plage inversée déclenche `ValueError` avec slot et bornes. Ne jamais échanger les bornes implicitement.

```python
def trim_indices(count: int, start: int, end: int, *, label: str) -> list[int]:
    if count <= 0:
        raise ValueError(f"{label}: empty source")
    first = max(0, min(int(start), count - 1))
    last = count - 1 if int(end) == -1 else max(0, min(int(end), count - 1))
    if last < first:
        raise ValueError(f"{label}: trim_end ({end}) precedes trim_start ({start})")
    return list(range(first, last + 1))
```

Dans `Append.execute`, calculer `indices = trim_indices(...)` **une seule fois**, puis sélectionner `tensor[indices]` et `_slice_audio_for_indices(audio, indices, clip_fps, sample_rate)`. Réutiliser l’implémentation dans `FrameRange` avec ses paramètres actuels. Définir une représentation compacte pour les longues plages si la liste devient coûteuse. Dans `src/preview/nodes/append.ts` et `src/preview/nodes/frame-range.ts`, reproduire exactement la validation et bloquer les handles inversés ; afficher la même erreur, sans simuler une autre coupe. Une suite de vecteurs JSON `{count,start,end,expected_indices|error}` doit être exécutée des deux côtés.

**Tests :** plage normale, `end=-1`, bornes hors plage, plage inversée, audio coupé aux échantillons attendus et scrub à la même frame qu’en backend.

## P0-B — Politique FPS explicite pour Append

**État :** `nodes/append.py` choisit le FPS du premier média et concatène ensuite les frames de toutes les entrées, même si les cadences diffèrent. Le contrôle du sample rate audio existe déjà, mais ne règle pas la différence de durée due aux FPS.

**Patch :** ajouter un input optionnel `fps_policy` dont la valeur par défaut est `strict`, et `target_fps` pour une conversion volontaire. Une entrée `IMAGE` reçoit une cadence déclarée par `image_fps` (défaut compatible : 24). Garder les sockets et widgets existants en place ; ajouter les nouveaux à la fin et tester le chargement d’anciens workflows.

- `strict` : accepter seulement les FPS identiques à une tolérance rationnelle définie ; erreur indiquant slots, FPS et durée. Cas `IMAGE` : cadence déclarée, visible dans l’UI.
- `conform_to_target` : calculer le nombre de frames depuis la durée source et `target_fps`, puis sélectionner la frame source au temps de sortie selon une règle documentée (`nearest`/drop-duplicate). Résampler l’audio **en temps**, si nécessaire ; une conversion de FPS ne doit pas changer sa vitesse de lecture.
- Pas de conversion audio cachée : si les sample rates diffèrent, garder l’erreur actuelle ou proposer une étape de resampling séparée.
- Aligner les durées de silence par clip sur sa durée effectivement générée, avec cumul des bornes pour limiter la dérive d’arrondi.

Factoriser ce mapping dans `nodes/core/timeline.py`, l’exposer en métadonnées UI pour la prévisualisation, et tester 24→30, 30→24, 23.976→24, clips muets et changement de sample rate. Tant qu’une conversion visuelle n’est pas implémentée, n’exposer que `strict` et ne pas offrir un mode inopérant.

## P0-C — Frame Range : plage vide et audio

**État :** `nodes/frame_range.py` remplace une sélection vide par `tensor[:1].clone()` mais peut y joindre l’audio original.

**Patch :** valider `source_count > 0` et `trim_end >= trim_start` après résolution de `-1`. Une plage invalide déclenche une erreur intelligible **avant** l’allocation ou la création de `VIDEO`. Garder le bypass tel quel. Retirer le fallback d’une frame et d’audio source. Si une sortie vide devient souhaitable plus tard, l’introduire par un mode nommé et tester le support effectif de `IMAGE` et `VIDEO` vides en aval.

**Tests :** plage inversée, source vide, plage à une frame avec audio limité à sa durée, hold, loop/bounce/reverse, sortie `IMAGE` et `VIDEO` et bypass.

## P1-A — États de validité du preview

**État :** `src/preview/core/renderer.ts` transmet le premier input quand aucun adapter n’existe et après exception de l’adapter. Le résultat peut ressembler à une image réellement traitée.

**Patch frontend :** faire remonter un `RenderResult` enrichi plutôt qu’un canvas seul :

```ts
type PreviewStatus = "live_proxy" | "backend_result" | "unsupported" | "error";
type PreviewResult = {
  canvas: HTMLCanvasElement | null;
  status: PreviewStatus;
  reason?: string;
  sourceNodeId?: number;
  frameIndex?: number;
  proxyScale?: number;
};
```

- Absence d’adapter : `unsupported`, avec nom du node ; un éventuel passthrough est marqué en surimpression et cet état se propage en aval.
- Exception : `error`, avec erreur courte dans le widget et détail en console. Ne pas mettre le passthrough en cache comme résultat réussi.
- Node source ou image calculée après queue : `backend_result` seulement pour les pixels effectivement issus de l’exécution ; ne pas inférer ce statut à partir d’une image similaire.
- Calcul `Canvas` de l’adapter : `live_proxy`; afficher résolution et frame source quand elles sont connues.

Mettre à jour `src/preview/shared/preview-widget.ts`, le host et les types afin de préserver le statut lors des caches et des rendus récursifs. Un upstream non pris en charge ne doit pas disparaître derrière un adapter downstream.

## P1-B — Parité proxy/backend et gestion de l’affichage

**État :** le frontend applique des opérations `Canvas` sur des images réduites ; le backend calcule en tenseurs à la résolution d’origine. L’aperçu peut diverger sur alpha, HDR, bordures, filtres et bruit.

**Patch :** conserver `Live proxy` comme outil interactif, puis proposer `Backend result` après exécution au même frame. Dans `ImageOpsPreview`, ajouter comparaison A/B, wipe et différence avec indication de l’espace couleur et de la frame. Pour chaque node, déclarer ses limites de preview (`exact`, `approximate`, `unsupported`) dans le registre d’adapters ; ne pas annoncer une parité universelle.

Jeu de référence : RGBA avec pixels transparents colorés, valeurs RGB < 0 et > 1, masque doux, détails subpixel, séquences de plusieurs FPS et frame fixe. Comparer après une transformation d’affichage commune ; documenter une tolérance numérique par opération, et examiner visuellement les différences perceptuelles. Éviter de faire transiter un résultat HDR comme PNG 8 bits puis de le déclarer équivalent au tenseur.

## P1-C — Alpha du padding Append

**État :** `nodes/append.py::_pad_to_size` initialise l’alpha de toute la toile à 1 pour une image RGBA, rendant les marges opaques.

**Patch :** ajouter `pad_alpha` explicite (`transparent` / `opaque`) et propager le choix dans l’adapter preview. Pour un workflow de compositing neuf, recommander `transparent` ; pour préserver les workflows existants, conserver le rendu historique par défaut ou fournir une migration vérifiée avant de modifier ce défaut. Remplir le padding RGB selon une couleur explicite (noir par défaut), sans modifier les pixels source. Vérifier les dimensions finales, l’alpha à chaque bord et un merge sur fond coloré.

## Architecture de timeline et provenance

`src/preview/core/video.ts` obtient les durées depuis `imgs`, VHS, l’élément vidéo, un cap ou des métadonnées. Ces sources n’ont pas la même certitude. Ajouter `timingSource` et `confidence: exact | estimated | unknown` au modèle d’UI. Les métadonnées backend exécutées priment sur les estimations du navigateur. Lors d’un scrub ou d’un seek vidéo asynchrone, annuler/ignorer les requêtes périmées ; ne jamais afficher la frame N avec le label N+1. Partager les vecteurs de mapping temporel avec les tests Python/TypeScript.

## Séquence de PR et validation

1. **PR 1 — timeline P0 :** tests reproduisant les trois défauts, moteur d’indices partagé, trim et audio synchronisés, validation des plages. Aucune modification de socket.
2. **PR 2 — cadence Append :** politique `strict` et tests de compatibilité des workflows. Ajouter `conform_to_target` uniquement avec rééchantillonnage vidéo/audio et tests complets.
3. **PR 3 — statut live preview :** résultat typé, propagation des erreurs, widget et cache. Tests frontend sur adapter absent, exception et chaînage.
4. **PR 4 — alpha et parité :** option de padding compatible, fixtures RGBA/HDR, comparaison backend/proxy et affichage des limites.
5. **PR 5 — validation réelle :** lancement des nodes sous un checkout ComfyUI épinglé, workflows IMAGE/VIDEO natifs, 1080p et séquence longue ; capturer métriques de mémoire et temps de scrub.

**Gate :** `pytest tests/unit tests/integration`, tests frontend du dépôt, build TypeScript, chargement réel des nodes V3, ouverture d’un ancien workflow, et comparaison image/audio sur les fixtures. Ne conclure à la parité qu’après résultats observés.

## Références

- [Append backend](../nodes/append.py), [Frame Range backend](../nodes/frame_range.py), [moteur preview](../src/preview/core/renderer.ts), [timing preview](../src/preview/core/video.ts)
- [Plan compositing existant](IMAGEOPS_PRO_COMPOSITING_EVOLUTION_CODEX_5_6_SOL.md) et [plan de correction existant](IMAGEOPS_CODEX_5_6_SOL_9_OF_10_CORRECTION_PLAN.md)
- [Documentation officielle ComfyUI V3](https://docs.comfy.org/custom-nodes/v3_migration) : `comfy_api.latest` suit une API en développement ; épingler et tester la version cible.
