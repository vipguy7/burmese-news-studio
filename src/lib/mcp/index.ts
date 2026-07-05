import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listBrainItems from "./tools/list-brain-items";
import saveBrainItem from "./tools/save-brain-item";
import searchBrainItems from "./tools/search-brain-items";
import generateSportContent from "./tools/generate-sport-content";
import translateFromBrain from "./tools/translate-from-brain";

// OAuth issuer MUST be the direct Supabase host (not the .lovable.cloud proxy).
// Vite inlines VITE_SUPABASE_PROJECT_ID at build time; the fallback keeps the
// issuer well-formed during manifest extraction — a real token never verifies
// against the sentinel.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "burmese-news-studio-mcp",
  title: "Burmese News Studio",
  version: "0.1.0",
  instructions:
    "Tools for the Burmese News Studio: manage the shared newsroom knowledge base ('second brain'), semantically recall past items, translate + rewrite them into publishing formats (video script, web article, social post, newsletter) in Burmese or English, and generate fan-first Burmese football/sports articles from a URL or text.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listBrainItems,
    searchBrainItems,
    saveBrainItem,
    translateFromBrain,
    generateSportContent,
  ],
});
