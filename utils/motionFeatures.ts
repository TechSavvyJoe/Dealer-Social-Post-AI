/**
 * Async LazyMotion feature bundle.
 *
 * `index.tsx` passes a loader to <LazyMotion features={...} strict>, and this
 * module is the target of that dynamic import. Keeping it as its own module —
 * with `domAnimation` as the *default* export, which is the shape LazyMotion's
 * async loader expects — is what lets Rollup split the DOM animation feature
 * set out of the boot-critical graph. The app paints first; the animation
 * runtime streams in immediately after and `m.*` components upgrade in place.
 *
 * Do not add anything else here, and do not import this module statically from
 * anywhere: either would drag the features back into the entry chunk and
 * silently undo the split.
 */
import { domAnimation } from "framer-motion";

export default domAnimation;
