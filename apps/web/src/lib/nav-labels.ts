"use client"

import { useExtracted } from "next-intl"
import { SETTINGS_SECTIONS } from "./nav"

/**
 * The settings sections' labels, translated.
 *
 * `NAV_ENTRIES` and `SETTINGS_SECTIONS` carry source-language strings because
 * extraction needs to see a literal inside `t()`, and a list of routes cannot
 * call a hook. So the mapping lives here rather than in each screen: the rail
 * and the account hub render the same list, and a label they disagreed on would
 * be the same drift the shared list exists to end.
 */
export function useSettingsSectionLabels() {
  const t = useExtracted()
  return {
    Profile: t("Profile"),
    Appearance: t("Appearance"),
    Navigation: t("Navigation"),
    "Year & periods": t("Year & periods"),
    "Average adjustments": t("Average adjustments"),
    "Year preset": t("Year preset"),
    "Custom averages": t("Custom averages"),
    "Assessment types": t("Assessment types"),
    Account: t("Account"),
    Integrations: t("Integrations"),
    "AI & processing": t("AI & processing"),
    "Avermate Node": t("Avermate Node"),
    "AI & managed storage": t("AI & managed storage"),
    About: t("About"),
  }
}

function useSettingsItemLabels() {
  const t = useExtracted()
  return {
    "Name and profile photo": t("Name and profile photo"),
    "Who you are": t("Who you are"),
    Language: t("Language"),
    "Theme and colors": t("Theme and colors"),
    "Match my device": t("Match my device"),
    "Colour and theme": t("Colour and theme"),
    "Build my own": t("Build my own"),
    Accents: t("Accents"),
    Typography: t("Typography"),
    "Typography and shape": t("Typography and shape"),
    "Body font": t("Body font"),
    "Heading font": t("Heading font"),
    "Cards and density": t("Cards and density"),
    "Corner rounding": t("Corner rounding"),
    "Enable seasonal themes": t("Enable seasonal themes"),
    "Seasonal touches": t("Seasonal touches"),
    Charts: t("Charts"),
    "Zoom to the data": t("Zoom to the data"),
    "Show the trend line": t("Show the trend line"),
    "Trend detail": t("Trend detail"),
    "Show child subject series": t("Show child subject series"),
    "Mark each point": t("Mark each point"),
    "Join the grade dots": t("Join the grade dots"),
    "Line style": t("Line style"),
    "Motion and haptics": t("Motion and haptics"),
    Feel: t("Feel"),
    "Haptic feedback": t("Haptic feedback"),
    "Reduce motion": t("Reduce motion"),
    "Sidebar navigation": t("Sidebar navigation"),
    "Button at the top": t("Button at the top"),
    "Mobile navigation": t("Mobile navigation"),
    "Phone tab bar": t("Phone tab bar"),
    "Academic year": t("Academic year"),
    "This year": t("This year"),
    "Year name": t("Year name"),
    Starts: t("Starts"),
    Ends: t("Ends"),
    "Averages out of": t("Averages out of"),
    "New grades out of": t("New grades out of"),
    "Pass mark": t("Pass mark"),
    "Decimal places": t("Decimal places"),
    "The general average": t("The general average"),
    Periods: t("Periods"),
    "School years": t("School years"),
    Subjects: t("Subjects"),
    "General average bonus by period": t("General average bonus by period"),
    "Subject bonus by period": t("Subject bonus by period"),
    "School year template": t("School year template"),
    "Custom average formulas": t("Custom average formulas"),
    "Assessment types and scales": t("Assessment types and scales"),
    "Email address": t("Email address"),
    Password: t("Password"),
    "Current password": t("Current password"),
    "New password": t("New password"),
    "Active sessions": t("Active sessions"),
    "Where you are signed in": t("Where you are signed in"),
    "Sign out": t("Sign out"),
    "Linked sign-ins": t("Linked sign-ins"),
    "Export my data": t("Export my data"),
    "Your data": t("Your data"),
    "Delete my account": t("Delete my account"),
    "Delete this account": t("Delete this account"),
    "Start over": t("Start over"),
    "ÉcoleDirecte connection": t("ÉcoleDirecte connection"),
    Username: t("Username"),
    "School time zone": t("School time zone"),
    "Student account number": t("Student account number"),
    "Pronote connection": t("Pronote connection"),
    "Skolengo connection": t("Skolengo connection"),
    "Moodle connection": t("Moodle connection"),
    "Connected services": t("Connected services"),
    Provider: t("Provider"),
    "Moodle site address": t("Moodle site address"),
    "Mobile token redirect": t("Mobile token redirect"),
    "PEM certificate chain": t("PEM certificate chain"),
    "AI service keys": t("AI service keys"),
    "AI provider keys": t("AI provider keys"),
    "Mistral OCR & podcasts": t("Mistral OCR & podcasts"),
    "OpenAI transcription": t("OpenAI transcription"),
    "OpenAI and OpenRouter models": t("OpenAI and OpenRouter models"),
    "Gemini multimodal embeddings": t("Gemini multimodal embeddings"),
    "Cohere reranking": t("Cohere reranking"),
    "ElevenLabs voices": t("ElevenLabs voices"),
    "Advanced retrieval": t("Advanced retrieval"),
    "Assistant models and routing": t("Assistant models and routing"),
    "Model fallback and limits": t("Model fallback and limits"),
    "Retrieval fallback policy": t("Retrieval fallback policy"),
    "Immutable embedding spaces": t("Immutable embedding spaces"),
    "Local and cloud rerankers": t("Local and cloud rerankers"),
    "Corpus reindexing": t("Corpus reindexing"),
    "Retrieval traces and evaluations": t("Retrieval traces and evaluations"),
    "Connect an MCP assistant": t("Connect an MCP assistant"),
    "Avermate MCP server": t("Avermate MCP server"),
    "Protected-resource metadata": t("Protected-resource metadata"),
    "OAuth clients and permissions": t("OAuth clients and permissions"),
    "What has access": t("What has access"),
    "Registered clients": t("Registered clients"),
    "Learning analysis privacy": t("Learning analysis privacy"),
    "Open learning privacy settings": t("Open learning privacy settings"),
    "Provider connections": t("Provider connections"),
    "Available capabilities": t("Available capabilities"),
    "Capability policies": t("Capability policies"),
    "AI usage and cost": t("AI usage and cost"),
    "Processing privacy": t("Processing privacy"),
    "Capability diagnostics": t("Capability diagnostics"),
    "Deployment readiness": t("Deployment readiness"),
    "Pair a Node": t("Pair a Node"),
    "Node health and manifest": t("Node health and manifest"),
    "Rotate or revoke Node credentials": t("Rotate or revoke Node credentials"),
    "Capability placement": t("Capability placement"),
    "Lifecycle and migration diagnostics": t(
      "Lifecycle and migration diagnostics"
    ),
    "Managed beta invitation": t("Managed beta invitation"),
    "Managed execution and limits": t("Managed execution and limits"),
    "Managed privacy and deletion": t("Managed privacy and deletion"),
    "Application version": t("Application version"),
    Support: t("Support"),
    "Install Avermate": t("Install Avermate"),
    Privacy: t("Privacy"),
    "Legal information": t("Legal information"),
  }
}

/** Every section, labelled — the order both surfaces present them in. */
export function useSettingsSections() {
  // Through a Map rather than indexing the record: the record's keys are the
  // nine literals above, a section's label is a `string`, and looking one up
  // would need an assertion that the two always agree. The fallback below is
  // the honest answer for a section whose label has not been translated yet.
  const labels = new Map(Object.entries(useSettingsSectionLabels()))
  const itemLabels = new Map(Object.entries(useSettingsItemLabels()))
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    label: labels.get(section.label) ?? section.label,
    items: section.items?.map((item) => ({
      ...item,
      label: itemLabels.get(item.label) ?? item.label,
    })),
  }))
}
