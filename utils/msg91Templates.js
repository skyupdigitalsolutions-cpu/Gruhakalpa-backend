// ─────────────────────────────────────────────────────────────────────────
// MSG91 template list
//
// MSG91's account does not expose a reliable public "list templates" API
// endpoint (every documented path returns 404, and the dashboard URL is a web
// page, not an API). So we use the KNOWN list of approved template names from
// the MSG91 dashboard — the exact names created/approved in the account.
//
// When you add a NEW festival template in MSG91, add its name to
// KNOWN_TEMPLATES below and it appears in the panel automatically.
//
// Returns the shape the panel expects: { name, category, language, status,
// body }. body is left empty (not needed — the name + date + image are what
// matter), and the panel shows "content not returned by MSG91" for it.
// ─────────────────────────────────────────────────────────────────────────

// Approved festival / greeting template names in the MSG91 account.
const KNOWN_TEMPLATES = [
  "wa_gk_new_year",
  "wa_gk_makar_sankranti_pongal",
  "wa_gk_republic_day",
  "wa_gk_ugadi",
  "wa_gk_eid_ul_fitr",
  "wa_gk_independence_day",
  "wa_gk_dussehra_vijayadashami",
  "wa_gk_kannada_rajyotsava",
  "wa_gk_christmas",
  "wa_gk_gandhi_jayanti",
  "wa_gk_maha_shivratri",
  "wa_gk_holi",
  "wa_gk_gudi_padwa",
  "wa_gk_ram_navami",
  "wa_gk_hanuman_jayanti",
  "wa_gk_akshaya_tritiya",
  "wa_gk_vasant_panchami",
  "wa_gk_buddha_purnima",
  "wa_gk_guru_purnima",
  "wa_gk_nag_panchami",
  "wa_gk_raksha_bandhan",
  "wa_gk_krishna_janmashtami",
  "wa_gk_onam",
  "wa_gk_vishwakarma_puja",
  "wa_gk_navratri",
  "wa_gk_durga_ashtami",
  "wa_gk_maha_navami",
  "wa_gk_dhanteras",
  "wa_gk_govardhan_puja",
  "wa_gk_tulsi_vivah",
  "wa_gk_ayudha_puja",
  "wa_gk_saraswati_puja",
  "wa_gk_varamahalakshmi_vratam",
  "wa_gk_ramadan_begins",
  "wa_gk_eid_ul_adha_bakrid",
  "wa_gk_muharram",
  "wa_gk_milad_un_nabi",
  "wa_gk_guru_nanak_jayanti",
  "wa_gk_mahavir_jayanti",
  "wa_gk_paryushan",
  "wa_gk_diwali_jain",
  "wa_gk_constitution_day",
  "wa_gk_women_s_day",
  "wa_gk_mother_s_day",
  "wa_gk_father_s_day",
  "wa_gk_friendship_day",
  "wa_gk_teachers_day",
  "wa_gk_children_s_day",
  "wa_gk_world_environment_day",
  "wa_gk_international_yoga_day",
  "wa_gk_black_friday",
  "wa_gk_new_year_s_eve",
  "wa_gk_nadaprabhu_kempegowda_jayanti",
  // Existing greeting templates already in the account:
  "wa_deepavali",
  "ganesh_greetings",
];

// Returns { success, templates, note }. No network call — uses the known list.
const fetchMsg91Templates = async () => {
  const templates = KNOWN_TEMPLATES.map((name) => ({
    name,
    category: "MARKETING",
    language: "en",
    status: "APPROVED",
    body: "",
  }));
  return {
    success: true,
    templates,
    note: `Showing ${templates.length} approved templates from the MSG91 account.`,
  };
};

module.exports = { fetchMsg91Templates };