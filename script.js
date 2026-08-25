// ==========================================
// MASTER GAME STATE & SYSTEM DATABASE
// ==========================================
let coins = 0;                  
const MAX_PURCHASE_CAP = 500;   
let loans = 0;
let loanInterest = 0;
let lastRoundSettlement = null;
let currentRound = 1;
let gameFinished = false;
let finalPlacements = [];
let activeMode = 'player';
let currentLang = 'en';
let activeEdition = new URLSearchParams(window.location.search).get("edition") === "simple"
  ? "simple"
  : "advanced";

let cardsDealtThisRound = false;
let eventDrawnThisRound = false;
let investmentsLocked = false;
let isMerchantActive = false;
let assignedCountry = null;
let currentHand = [];
let activeGlobalCondition = null;

// Skirmish Engine State
let skirmishMaxAllowedAttacks = 1;
let skirmishAttacksExecuted = 0;

// Alliance & Pending Proposal State
let activePresidentCoalition = null;
let activeCounterUnion = null;
let pendingAllianceProposal = null;
let allianceCombatTargets = [];
let pendingTradeProposal = null;
let pendingOutgoingTrade = null;

// Round Closure Consensus Tracking State
let isLocalPlayerReadyToClose = false;
let readyPlayersSet = new Set();
let lockedPlayersSet = new Set();
let registeredPlayersCount = 1;

let pendingCoinRequests = [];
let gameActivityLedger = [];
let gameResultAlertQueue = [];
let activeGameResultAlert = null;
let gameResultAlertSequence = 0;
let previouslyFocusedGameResultElement = null;
let isRoomCreator = false;
let lastHostEventId = 0;
let hostEventPollingStarted = false;
const seenGameResultAlertIds = new Set();
const soundPreferenceKey = "world_war_sound_enabled";
const visualPulseTimers = new WeakMap();
const MAX_COIN_REQUESTS = 5;

function isSimpleEdition() {
  return activeEdition === "simple";
}

function editionQuery() {
  return `edition=${encodeURIComponent(activeEdition)}`;
}

function editionApiPath(path) {
  return `${path}${path.includes("?") ? "&" : "?"}${editionQuery()}`;
}

function applyEditionUi(edition) {
  activeEdition = edition === "simple" ? "simple" : "advanced";
  document.body?.setAttribute("data-edition", activeEdition);
  syncEditionTitle();
  setTxt("tv-room-code", `WW-TABLE · ${activeEdition.toUpperCase()}`);
}

function syncEditionTitle() {
  const title = document.getElementById("txt-title");
  if (!title) return;
  const copy = translations[currentLang] || translations.en;
  const label = activeEdition === "simple" ? "Simple Edition" : "Advanced Edition";
  title.textContent = `${copy.txtTitle} (${label})`;
}

const GLOBAL_CONDITION_CARDS = [
  {
    id: "economic-recession",
    title: "📉 Economic Recession",
    desc: "Trade income is reduced by 20% this round.",
    tradeIncomeMultiplier: 0.8
  },
  {
    id: "global-warming",
    title: "🌡️ Global Warming",
    desc: "Agriculture and Oil income is reduced by 10% this round.",
    agricultureIncomeMultiplier: 0.9,
    oilIncomeMultiplier: 0.9
  },
  {
    id: "pandemic",
    title: "🦠 Pandemic",
    desc: "One randomly selected resource multiplier becomes ×1 this round."
  },
  {
    id: "cold-war",
    title: "🕊️ Cold War",
    desc: "Spy cards cannot be played this round.",
    blocksSpyCards: true
  },
  {
    id: "blackout",
    title: "🌑 Blackout",
    desc: "Opponent multipliers and total investments are hidden this round."
  }
];

const globalConditionTranslations = {
  en: {
    "economic-recession": { title: "📉 Economic Recession", desc: "Trade income is reduced by 20% this round." },
    "global-warming": { title: "🌡️ Global Warming", desc: "Agriculture and Oil income is reduced by 10% this round." },
    pandemic: {
      title: "🦠 Pandemic",
      desc: field => `The ${globalConditionFieldLabel(field, "en")} multiplier becomes ×1 this round.`
    },
    "cold-war": { title: "🕊️ Cold War", desc: "Spy cards cannot be played this round." },
    blackout: { title: "🌑 Blackout", desc: "Opponent multipliers and total investments are hidden this round." }
  },
  tr: {
    "economic-recession": { title: "📉 Ekonomik Durgunluk", desc: "Ticaret geliri bu raund %20 azalır." },
    "global-warming": { title: "🌡️ Küresel Isınma", desc: "Tarım ve petrol geliri bu raund %10 azalır." },
    pandemic: {
      title: "🦠 Pandemi",
      desc: field => `${globalConditionFieldLabel(field, "tr")} çarpanı bu raund ×1 olur.`
    },
    "cold-war": { title: "🕊️ Soğuk Savaş", desc: "Casus kartları bu raund kullanılamaz." },
    blackout: { title: "🌑 Karartma", desc: "Rakip çarpanları ve toplam yatırımları bu raund gizlenir." }
  },
  fa: {
    "economic-recession": { title: "📉 رکود اقتصادی", desc: "درآمد تجارت در این دور ۲۰٪ کاهش می‌یابد." },
    "global-warming": { title: "🌡️ گرمایش جهانی", desc: "درآمد کشاورزی و نفت در این دور ۱۰٪ کاهش می‌یابد." },
    pandemic: {
      title: "🦠 همه‌گیری",
      desc: field => `ضریب ${globalConditionFieldLabel(field, "fa")} در این دور ×۱ می‌شود.`
    },
    "cold-war": { title: "🕊️ جنگ سرد", desc: "کارت‌های جاسوس در این دور قابل استفاده نیستند." },
    blackout: { title: "🌑 خاموشی", desc: "ضرایب و مجموع سرمایه‌گذاری حریفان در این دور پنهان می‌شود." }
  }
};

function globalConditionFieldLabel(field, lang = currentLang) {
  const labels = {
    en: { agri: "Agriculture", oil: "Oil", mines: "Mines" },
    tr: { agri: "Tarım", oil: "Petrol", mines: "Madenler" },
    fa: { agri: "کشاورزی", oil: "نفت", mines: "معادن" }
  };
  return labels[lang]?.[field] || labels.en[field] || "selected resource";
}

function describeGlobalCondition(condition) {
  const base = GLOBAL_CONDITION_CARDS.find(card => card.id === condition?.id);
  if (!base) return null;
  const copy = globalConditionTranslations[currentLang]?.[base.id] || globalConditionTranslations.en[base.id];
  const desc = typeof copy?.desc === "function" ? copy.desc(condition?.field) : copy?.desc;
  return {
    ...base,
    id: base.id,
    field: condition?.field,
    title: copy?.title || base.title,
    desc: desc || base.desc
  };
}

// ==========================================
// MULTI-LANGUAGE TRANSLATION DICTIONARY (i18n)
// ==========================================
const translations = {
  en: {
    txtTitle: "Global Domination & Fortune",
    lblViewMode: "View Mode:",
    btnModePlayer: "Mobile Player 📱",
    btnModeHost: "Host Console 👑",
    lblStatus: "Status",
    txtHostTitle: "👑 Game Runner (Host) Controls",
    txtReferee: "Master Referee Active",
    txtMasterCtrl: "Master Game Controls",
    btnHostDeal: "Deal Cards (2 per player)",
    btnHostEvent: "Draw Global Event",
    btnHostAdvance: "Close & Calculate Round",
    txtGlobalEventTitle: "🌍 Active Global Event",
    txtPendingRequestsTitle: "📥 Pending Coin Purchase Requests",
    txtEconomyTitle: "Economy & Banker",
    lblCountry: "Country:",
    lblCoins: "Total Coins Balance:",
    lblLoan: "Active Loan:",
    txtLoanCalculatorTitle: "Banker Loan Calculator",
    txtLoanModalTitle: "Banker Loan",
    txtLoanModalDesc: "The loan amount is automatically fixed at 20% of your available unallocated cash. Principal plus 20% interest is repaid when you settle the loan.",
    txtLoanAmountLabel: "Fixed loan amount:",
    btnConfirmLoan: "Take Loan",
    btnCancelLoan: "Cancel",
    lblLoanPrincipal: "Principal:",
    lblLoanInterest: "Interest (20%):",
    lblLoanTotal: "Total repayment:",
    lblLoanAvailable: "Unallocated cash:",
    lblLoanShortfall: "Shortfall:",
    btnRepayLoan: "Repay Loan + Interest",
    txtLoanNoDebt: "No active Banker loan.",
    txtLoanInsufficient: "You need {shortfall} more coins to settle this loan.",
    txtLoanReady: "Your unallocated cash can fully settle this loan.",
    txtSettlementTitle: "Latest Server Settlement",
    txtSettlementEmpty: "The server will show a field-by-field breakdown after the round closes.",
    txtSettlementGross: "Gross field income",
    txtSettlementLoan: "Loan collected",
    txtSettlementBalance: "Ending balance",
    txtSettlementSolo: "Solo fields",
    txtSettlementAlliance: "Alliance pool",
    txtBattleLoanGate: "Field Battles are locked until your loan and interest are fully repaid.",
    txtBattleReady: "Loan settled — Field Battle available.",
    txtBoardBattleLoanLocked: "Settle loan to battle",
    lblMerchantBonus: "Merchant Bonus Active:",
    txtReadyTitle: "🏁 Round Closure Consensus",
    txtReadyDesc: "Lock investments, finish all actions, and mark ready. The host can advance after every setup step is complete.",
    txtMultTitle: "Resource Multipliers",
    lblMultAgri: "Agriculture",
    lblMultOil: "Oil",
    lblMultMines: "Mines",
    btnBuyCoins: "Buy 100 Coins (Max 500)",
    txtInvestTitle: "Field Investments",
    lblUnallocated: "Unallocated:",
    btnLockInvest: "Lock In Investments",
    btnReadyNextRound: "🏁 Ready for Next Round",
    txtHandTitle: "Your Proficiency Hand (2 Cards)",
    txtClickCard: "👆 Click Card to Action",
    txtAtomicDisabled: "Disabled during Pandemic",
    txtAnnouncements: "📣 Round Announcements",
    txtAnnouncementsSubtitle: "Current round activity only",
    txtGameResultContinue: "Continue",
    txtBlackoutHidden: "🌑 BLACKOUT — Intelligence hidden",
    txtBoardBlackout: "Blackout active — opponent multipliers and total investment are hidden.",
    txtCommandBoardKicker: "LIVE STRATEGIC MAP",
    txtCommandBoardTitle: "Command Board",
    txtCommandBoardDesc: "Select an opposing country to inspect its multipliers, total investment, and available actions.",
    txtBoardConditionClear: "No active condition",
    txtBoardEmpty: "Awaiting other seated commanders…",
    txtBoardDetailsEmpty: "Select an opposing country to view its command profile.",
    txtBoardPlanning: "Planning",
    txtBoardLocked: "Investments locked",
    txtBoardReady: "Ready to close",
    txtBoardTrade: "Open Field Trade",
    txtBoardBattle: "Open Field Battle",
    txtBoardTradeUsed: "Field Trade is unavailable: both proposals have been used this round.",
    txtBoardBattleLoanLocked: "Settle your loan and interest before Field Battle is available.",
    txtBoardBattleUsed: "Field Battle is unavailable: all attacks have been used this round.",
    txtBoardBattleLocked: "Field Battle opens after both countries lock investments.",
    txtBoardActionsAvailable: "Choose an available action for this country.",
    txtBoardTotalInvestment: "Total field investment: {total} coins",
    txtBoardTotalPending: "Total field investment: pending",
    txtHitmanModalTitle: "🕶️ Hitman Operation",
    txtHitmanModalDesc: "Choose an opposing country and which card type to target.",
    lblHitmanTargetCountry: "Country to target:",
    lblHitmanTargetCard: "Card type to disable:",
    txtHitmanGeneralOption: "🎖️ General",
    txtHitmanSpyOption: "🕵️ Spy",
    btnHitmanStrike: "🕶️ Execute Hitman Operation",
    txtBoardAlliance: "Alliance",
    txtStatusKicker: "COMMANDER STATUS",
    txtNextMove: "NEXT MOVE",
    txtStatusRound: "Round",
    txtStatusClear: "Clear",
    txtGameCardsKicker: "ROUND DECK",
    txtGameCardsTitle: "Game Cards",
    txtGameCardsDesc: "Live conditions and your available proficiency cards.",
    ariaGameTabs: "Game phases",
    txtTabStatus: "Status & Cards",
    txtTabPrepare: "Prepare",
    txtTabAct: "Act",
    txtTabReview: "Review",
    txtTabNow: "NOW",
    txtTabDone: "DONE",
    txtTabPending: "PENDING",
    txtTabActions: "{count} actions",
    txtTabReady: "READY",
    txtTabOpen: "OPEN",
    ariaRoundProgress: "Round progress",
    ariaCommanderSummary: "Commander summary",
    ariaRoundReadiness: "Round readiness",
    ariaCommandBoard: "Interactive country command board",
    txtStatusCountry: "Country",
    txtStatusCoins: "Coins",
    txtStatusUnallocated: "Free to use",
    txtStatusLoan: "Loan",
    txtStatusTrades: "Trades left",
    txtStatusBattles: "Battles left",
    txtCoinRequests: "Coin requests",
    txtCoinRequestsUsed: "{used} / {limit} used this game",
    txtPrepareSection: "Prepare",
    txtPrepareSectionDesc: "Set your economy and lock investments",
    txtFlowPrepare: "Prepare",
    txtFlowAct: "Act",
    txtFlowReview: "Review",
    txtActSection: "Act",
    txtActSectionDesc: "Trade, battle, or use a proficiency card",
    txtReviewSection: "Review",
    txtReviewSectionDesc: "Check the table and finish the round",
    txtStatusLock: "Lock your investments",
    txtStatusAct: "Trade, battle, or use a card",
    txtStatusReady: "Mark yourself ready",
    txtStatusWaiting: "Waiting for the host",
    txtStatusComplete: "Review final results",
    txtStatusPrepareWait: "Wait for every commander to complete Prepare",
    txtActActionsLocked: "Complete Prepare for every commander before using Act actions.",
    txtActReviewLocked: "You marked ready, so Act actions are closed for you this round.",
    txtGeneralActOnly: "🎖️ Complete Prepare before activating General in Act.",
    txtHitmanPrepareOnly: "🕶️ Use Hitman during Prepare before locking investments.",
    btnHostDealUsed: "✓ Cards Dealt This Round",
    btnHostEventLocked: "Deal Cards Before Drawing Event",
    btnHostEventUsed: "✓ Global Event Drawn"
  },
  tr: {
    txtTitle: "Küresel Hakimiyet ve Servet",
    lblViewMode: "Görünüm Modu:",
    btnModePlayer: "Mobil Oyuncu 📱",
    btnModeHost: "Yönetici Konsolu 👑",
    lblStatus: "Durum",
    txtHostTitle: "👑 Oyun Yöneticisi Kontrolleri",
    txtReferee: "Baş Hakem Aktif",
    txtMasterCtrl: "Ana Oyun Kontrolleri",
    btnHostDeal: "Kart Dağıt (Oyuncu Başı 2)",
    btnHostEvent: "Küresel Etkinlik Çek",
    btnHostAdvance: "Raundu Kapat ve Hesapla",
    txtGlobalEventTitle: "🌍 Aktif Küresel Etkinlik",
    txtPendingRequestsTitle: "📥 Bekleyen Coin Satın Alım İstekleri",
    txtEconomyTitle: "Ekonomi ve Banker",
    lblCountry: "Ülke:",
    lblCoins: "Toplam Coin Bakiyesi:",
    lblLoan: "Aktif Kredi:",
    txtLoanCalculatorTitle: "Banker Kredi Hesaplayıcısı",
    txtLoanModalTitle: "Banker Kredisi",
    txtLoanModalDesc: "Kredi tutarı, kullanılabilir ayrılmamış nakdinizin %20'si olarak otomatik belirlenir. Krediyi kapatırken ana para ve %20 faiz ödenir.",
    txtLoanAmountLabel: "Sabit kredi tutarı:",
    btnConfirmLoan: "Krediyi Al",
    btnCancelLoan: "İptal",
    lblLoanPrincipal: "Ana para:",
    lblLoanInterest: "Faiz (%20):",
    lblLoanTotal: "Toplam ödeme:",
    lblLoanAvailable: "Ayrılmamış nakit:",
    lblLoanShortfall: "Eksik coin:",
    btnRepayLoan: "Kredi + Faizi Öde",
    txtLoanNoDebt: "Aktif Banker kredisi yok.",
    txtLoanInsufficient: "Bu krediyi kapatmak için {shortfall} coin daha gerekli.",
    txtLoanReady: "Ayrılmamış nakdiniz bu krediyi tamamen kapatmaya yeterli.",
    txtSettlementTitle: "Son Sunucu Hesaplaşması",
    txtSettlementEmpty: "Raund kapandığında sunucu saha bazlı dökümü burada gösterir.",
    txtSettlementGross: "Brüt saha geliri",
    txtSettlementLoan: "Tahsil edilen kredi",
    txtSettlementBalance: "Bitiş bakiyesi",
    txtSettlementSolo: "Tekil sahalar",
    txtSettlementAlliance: "İttifak havuzu",
    txtBattleLoanGate: "Saha Savaşları, kredi ve faiz tamamen ödenene kadar kilitlidir.",
    txtBattleReady: "Kredi kapatıldı — Saha Savaşı kullanılabilir.",
    txtBoardBattleLoanLocked: "Savaş için krediyi öde",
    lblMerchantBonus: "Tüccar Bonusu Aktif:",
    txtReadyTitle: "🏁 Raund Kapatma Konsensüsü",
    txtReadyDesc: "Yatırımları kilitleyin, tüm hamleleri bitirin ve hazır olun. Yönetici tüm hazırlıklar tamamlanınca ilerleyebilir.",
    txtMultTitle: "Kaynak Çarpanları",
    lblMultAgri: "Tarım",
    lblMultOil: "Petrol",
    lblMultMines: "Madenler",
    btnBuyCoins: "100 Coin Al (Maks 500)",
    txtInvestTitle: "Saha Yatırımları",
    lblUnallocated: "Ayrılmamış:",
    btnLockInvest: "Yatırımları Kilitle",
    btnReadyNextRound: "🏁 Sonraki Raund İçin Hazır",
    txtHandTitle: "Uzmanlık Kart Eliniz (2 Kart)",
    txtClickCard: "👆 Eylem İçin Karta Tıklayın",
    txtAtomicDisabled: "Pandemi sırasında devre dışı",
    txtAnnouncements: "📣 Raund Duyuruları",
    txtAnnouncementsSubtitle: "Yalnızca mevcut raund etkinlikleri",
    txtGameResultContinue: "Devam",
    txtBlackoutHidden: "🌑 KARARTMA — İstihbarat gizli",
    txtBoardBlackout: "Karartma aktif — rakip çarpanları ve toplam yatırımları gizli.",
    txtCommandBoardKicker: "CANLI STRATEJİ HARİTASI",
    txtCommandBoardTitle: "Komuta Panosu",
    txtCommandBoardDesc: "Çarpanlarını, toplam yatırımını ve kullanılabilir eylemlerini incelemek için rakip bir ülke seçin.",
    txtBoardConditionClear: "Aktif etkinlik yok",
    txtBoardEmpty: "Diğer oturmuş komutanlar bekleniyor…",
    txtBoardDetailsEmpty: "Komuta profilini görmek için rakip bir ülke seçin.",
    txtBoardPlanning: "Planlama",
    txtBoardLocked: "Yatırımlar kilitli",
    txtBoardReady: "Kapanışa hazır",
    txtBoardTrade: "Saha Ticaretini Aç",
    txtBoardBattle: "Saha Savaşını Aç",
    txtBoardTradeUsed: "Saha Ticareti kullanılamıyor: bu raund iki teklif de kullanıldı.",
    txtBoardBattleLoanLocked: "Saha Savaşı açılmadan önce kredi ve faizi ödeyin.",
    txtBoardBattleUsed: "Saha Savaşı kullanılamıyor: bu raund tüm saldırılar kullanıldı.",
    txtBoardBattleLocked: "Saha Savaşı, iki ülke de yatırımlarını kilitlediğinde açılır.",
    txtBoardActionsAvailable: "Bu ülke için kullanılabilir bir hamle seçin.",
    txtBoardTotalInvestment: "Toplam saha yatırımı: {total} coin",
    txtBoardTotalPending: "Toplam saha yatırımı: bekliyor",
    txtHitmanModalTitle: "🕶️ Hitman Operasyonu",
    txtHitmanModalDesc: "Bir rakip ülke ve hedef alınacak kart türünü seçin.",
    lblHitmanTargetCountry: "Hedef ülke:",
    lblHitmanTargetCard: "Devre dışı bırakılacak kart türü:",
    txtHitmanGeneralOption: "🎖️ General",
    txtHitmanSpyOption: "🕵️ Spy",
    btnHitmanStrike: "🕶️ Hitman Operasyonunu Başlat",
    txtBoardAlliance: "İttifak",
    txtStatusKicker: "KOMUTAN DURUMU",
    txtNextMove: "SIRADAKİ HAMLE",
    txtStatusRound: "Raund",
    txtStatusClear: "Yok",
    txtGameCardsKicker: "RAUND DESTESİ",
    txtGameCardsTitle: "Oyun Kartları",
    txtGameCardsDesc: "Canlı koşullar ve kullanılabilir uzmanlık kartlarınız.",
    ariaGameTabs: "Oyun aşamaları",
    txtTabStatus: "Durum ve Kartlar",
    txtTabPrepare: "Hazırlık",
    txtTabAct: "Hamle",
    txtTabReview: "Kontrol",
    txtTabNow: "ŞİMDİ",
    txtTabDone: "TAMAM",
    txtTabPending: "BEKLİYOR",
    txtTabActions: "{count} hamle",
    txtTabReady: "HAZIR",
    txtTabOpen: "AÇIK",
    ariaRoundProgress: "Raund ilerlemesi",
    ariaCommanderSummary: "Komutan özeti",
    ariaRoundReadiness: "Raund hazırlık durumu",
    ariaCommandBoard: "Etkileşimli ülke komuta panosu",
    txtStatusCountry: "Ülke",
    txtStatusCoins: "Coin",
    txtStatusUnallocated: "Kullanılabilir",
    txtStatusLoan: "Kredi",
    txtStatusTrades: "Kalan ticaret",
    txtStatusBattles: "Kalan savaş",
    txtCoinRequests: "Coin talepleri",
    txtCoinRequestsUsed: "Bu oyunda {used} / {limit} kullanıldı",
    txtPrepareSection: "Hazırlık",
    txtPrepareSectionDesc: "Ekonominizi kurun ve yatırımları kilitleyin",
    txtFlowPrepare: "Hazırlık",
    txtFlowAct: "Hamle",
    txtFlowReview: "Kontrol",
    txtActSection: "Hamle",
    txtActSectionDesc: "Ticaret yapın, savaşın veya uzmanlık kartı kullanın",
    txtReviewSection: "Kontrol",
    txtReviewSectionDesc: "Masayı kontrol edin ve raundu tamamlayın",
    txtStatusLock: "Yatırımları kilitle",
    txtStatusAct: "Ticaret, savaş veya kart",
    txtStatusReady: "Hazır olduğunuzu belirtin",
    txtStatusWaiting: "Yönetici bekleniyor",
    txtStatusComplete: "Sonuçları inceleyin",
    txtStatusPrepareWait: "Her komutanın Hazırlığı tamamlamasını bekleyin",
    txtActActionsLocked: "Hamle eylemlerini kullanmadan önce tüm komutanların Hazırlığı tamamlamasını bekleyin.",
    txtActReviewLocked: "Hazır olduğunuzu belirttiniz; bu raund için Hamle eylemleri size kapalı.",
    txtGeneralActOnly: "🎖️ General kartını Hamle aşamasında etkinleştirmeden önce Hazırlığı tamamlayın.",
    txtHitmanPrepareOnly: "🕶️ Yatırımları kilitlemeden önce Hitman kartını Hazırlıkta kullanın.",
    btnHostDealUsed: "✓ Kartlar Bu Raund Dağıtıldı",
    btnHostEventLocked: "Önce Kartları Dağıtın",
    btnHostEventUsed: "✓ Küresel Etkinlik Çekildi"
  },
  fa: {
    txtTitle: "تسلط جهانی و ثروت",
    lblViewMode: "حالت نمایش:",
    btnModePlayer: "بازیکن موبایل 📱",
    btnModeHost: "کنسول میزبان 👑",
    lblStatus: "وضعیت",
    txtHostTitle: "👑 کنترل‌های مدیر بازی (میزبان)",
    txtReferee: "داور اصلی فعال است",
    txtMasterCtrl: "کنترل‌های اصلی بازی",
    btnHostDeal: "توزیع کارت (۲ عدد برای هر بازیکن)",
    btnHostEvent: "کارت رویداد جهانی",
    btnHostAdvance: "بستن و محاسبه نتایج دور",
    txtGlobalEventTitle: "🌍 رویداد جهانی فعال",
    txtPendingRequestsTitle: "📥 درخواست‌های معلق خرید سکه",
    txtEconomyTitle: "اقتصاد و Banker",
    lblCountry: "کشور:",
    lblCoins: "موجودی کل سکه:",
    lblLoan: "وام فعال:",
    txtLoanCalculatorTitle: "محاسبه‌گر تسویه وام Banker",
    txtLoanModalTitle: "وام Banker",
    txtLoanModalDesc: "مبلغ وام به‌طور خودکار برابر با ۲۰٪ نقدی تخصیص‌نیافته شماست. هنگام تسویه، اصل وام به‌علاوه ۲۰٪ بهره پرداخت می‌شود.",
    txtLoanAmountLabel: "مبلغ ثابت وام:",
    btnConfirmLoan: "دریافت وام",
    btnCancelLoan: "لغو",
    lblLoanPrincipal: "اصل وام:",
    lblLoanInterest: "بهره (۲۰٪):",
    lblLoanTotal: "مبلغ کل بازپرداخت:",
    lblLoanAvailable: "نقدی تخصیص‌نیافته:",
    lblLoanShortfall: "کسری:",
    btnRepayLoan: "پرداخت وام + بهره",
    txtLoanNoDebt: "وام فعال Banker ندارید.",
    txtLoanInsufficient: "برای تسویه این وام به {shortfall} سکه دیگر نیاز دارید.",
    txtLoanReady: "نقدی تخصیص‌نیافته برای تسویه کامل وام کافی است.",
    txtSettlementTitle: "آخرین تسویه تأییدشده سرور",
    txtSettlementEmpty: "پس از بسته شدن دور، سرور جزئیات هر زمین را اینجا نشان می‌دهد.",
    txtSettlementGross: "درآمد ناخالص زمین‌ها",
    txtSettlementLoan: "وام وصول‌شده",
    txtSettlementBalance: "موجودی پایانی",
    txtSettlementSolo: "زمین‌های مستقل",
    txtSettlementAlliance: "استخر ائتلاف",
    txtBattleLoanGate: "تا بازپرداخت کامل وام و بهره، نبردهای میدانی قفل هستند.",
    txtBattleReady: "وام تسویه شد — نبرد میدانی در دسترس است.",
    txtBoardBattleLoanLocked: "برای نبرد وام را بپردازید",
    lblMerchantBonus: "پاداش بازرگان فعال:",
    txtReadyTitle: "🏁 اجماع بستن دور بازی",
    txtReadyDesc: "سرمایه‌گذاری‌ها را قفل کنید، اقدامات را تمام کنید و آماده شوید. میزبان پس از تکمیل همه مراحل می‌تواند ادامه دهد.",
    txtMultTitle: "ضریب‌های منابع",
    lblMultAgri: "کشاورزی",
    lblMultOil: "نفت",
    lblMultMines: "معادن",
    btnBuyCoins: "خرید ۱۰۰ سکه (حداکثر ۵۰۰)",
    txtInvestTitle: "سرمایه‌گذاری‌های زمینی",
    lblUnallocated: "تخصیص‌نیافته:",
    btnLockInvest: "قفل سرمایه‌گذاری‌ها",
    btnReadyNextRound: "🏁 آماده برای دور بعد",
    txtHandTitle: "دست کارت‌های مهارت شما (۲ کارت)",
    txtClickCard: "👆 برای اقدام روی کارت کلیک کنید",
    txtAtomicDisabled: "در زمان همه‌گیری غیرفعال است",
    txtAnnouncements: "📣 اطلاعیه‌های دور",
    txtAnnouncementsSubtitle: "فقط فعالیت‌های دور جاری",
    txtGameResultContinue: "ادامه",
    txtBlackoutHidden: "🌑 خاموشی — اطلاعات پنهان است",
    txtBoardBlackout: "خاموشی فعال است — ضرایب و مجموع سرمایه‌گذاری حریفان پنهان است.",
    txtCommandBoardKicker: "نقشه زنده راهبردی",
    txtCommandBoardTitle: "برد فرماندهی",
    txtCommandBoardDesc: "برای بررسی ضریب‌ها، مجموع سرمایه‌گذاری و اقدامات در دسترس، یک کشور رقیب را انتخاب کنید.",
    txtBoardConditionClear: "رویداد فعالی نیست",
    txtBoardEmpty: "در انتظار دیگر فرماندهان نشسته…",
    txtBoardDetailsEmpty: "برای دیدن نمای فرماندهی، یک کشور رقیب را انتخاب کنید.",
    txtBoardPlanning: "در حال برنامه‌ریزی",
    txtBoardLocked: "سرمایه‌گذاری‌ها قفل شده‌اند",
    txtBoardReady: "آماده بستن دور",
    txtBoardTrade: "باز کردن معامله میدانی",
    txtBoardBattle: "باز کردن نبرد میدانی",
    txtBoardTradeUsed: "معامله میدانی در دسترس نیست: هر دو پیشنهاد این دور استفاده شده‌اند.",
    txtBoardBattleLoanLocked: "پیش از فعال شدن نبرد میدانی، وام و بهره را تسویه کنید.",
    txtBoardBattleUsed: "نبرد میدانی در دسترس نیست: همه حمله‌های این دور استفاده شده‌اند.",
    txtBoardBattleLocked: "نبرد میدانی پس از قفل شدن سرمایه‌گذاری هر دو کشور باز می‌شود.",
    txtBoardActionsAvailable: "یک اقدام در دسترس برای این کشور انتخاب کنید.",
    txtBoardTotalInvestment: "مجموع سرمایه‌گذاری میدان: {total} سکه",
    txtBoardTotalPending: "مجموع سرمایه‌گذاری میدان: در انتظار",
    txtHitmanModalTitle: "🕶️ عملیات هیتمن",
    txtHitmanModalDesc: "یک کشور رقیب و نوع کارت هدف را انتخاب کنید.",
    lblHitmanTargetCountry: "کشور هدف:",
    lblHitmanTargetCard: "نوع کارت برای غیرفعال‌سازی:",
    txtHitmanGeneralOption: "🎖️ ژنرال",
    txtHitmanSpyOption: "🕵️ جاسوس",
    btnHitmanStrike: "🕶️ اجرای عملیات هیتمن",
    txtBoardAlliance: "ائتلاف",
    txtStatusKicker: "وضعیت فرمانده",
    txtNextMove: "حرکت بعدی",
    txtStatusRound: "دور",
    txtStatusClear: "ندارد",
    txtGameCardsKicker: "دسته کارت دور",
    txtGameCardsTitle: "کارت‌های بازی",
    txtGameCardsDesc: "شرایط زنده و کارت‌های مهارت در دسترس شما.",
    ariaGameTabs: "مراحل بازی",
    txtTabStatus: "وضعیت و کارت‌ها",
    txtTabPrepare: "آماده‌سازی",
    txtTabAct: "اقدام",
    txtTabReview: "بررسی",
    txtTabNow: "اکنون",
    txtTabDone: "انجام شد",
    txtTabPending: "در انتظار",
    txtTabActions: "{count} اقدام",
    txtTabReady: "آماده",
    txtTabOpen: "باز",
    ariaRoundProgress: "پیشرفت دور",
    ariaCommanderSummary: "خلاصه فرمانده",
    ariaRoundReadiness: "آمادگی دور",
    ariaCommandBoard: "برد تعاملی فرماندهی کشورها",
    txtStatusCountry: "کشور",
    txtStatusCoins: "سکه",
    txtStatusUnallocated: "قابل استفاده",
    txtStatusLoan: "وام",
    txtStatusTrades: "معامله باقی‌مانده",
    txtStatusBattles: "نبرد باقی‌مانده",
    txtCoinRequests: "درخواست سکه",
    txtCoinRequestsUsed: "{used} / {limit} استفاده در این بازی",
    txtPrepareSection: "آماده‌سازی",
    txtPrepareSectionDesc: "اقتصاد خود را تنظیم و سرمایه‌گذاری‌ها را قفل کنید",
    txtFlowPrepare: "آماده‌سازی",
    txtFlowAct: "اقدام",
    txtFlowReview: "بررسی",
    txtActSection: "اقدام",
    txtActSectionDesc: "معامله کنید، بجنگید یا از کارت مهارت استفاده کنید",
    txtReviewSection: "بررسی",
    txtReviewSectionDesc: "میز را بررسی و دور را تمام کنید",
    txtStatusLock: "قفل کردن سرمایه‌گذاری‌ها",
    txtStatusAct: "معامله، نبرد یا کارت",
    txtStatusReady: "اعلام آمادگی",
    txtStatusWaiting: "در انتظار میزبان",
    txtStatusComplete: "بررسی نتایج نهایی",
    txtStatusPrepareWait: "منتظر بمانید تا همه فرماندهان آماده‌سازی را تمام کنند",
    txtActActionsLocked: "پیش از استفاده از اقدام‌های مرحله عمل، آماده‌سازی همه فرماندهان را کامل کنید.",
    txtActReviewLocked: "شما آماده بودن را اعلام کرده‌اید؛ اقدام‌های مرحله عمل برای این دور بسته‌اند.",
    txtGeneralActOnly: "🎖️ پیش از فعال‌سازی ژنرال در مرحله اقدام، آماده‌سازی را کامل کنید.",
    txtHitmanPrepareOnly: "🕶️ پیش از قفل کردن سرمایه‌گذاری‌ها، هیتمن را در آماده‌سازی استفاده کنید.",
    btnHostDealUsed: "✓ کارت‌ها در این دور توزیع شدند",
    btnHostEventLocked: "ابتدا کارت‌ها را توزیع کنید",
    btnHostEventUsed: "✓ رویداد جهانی کشیده شد"
  }
};

const notificationUiCopy = {
  en: {
    empty: "No announcements yet for this round.",
    moreResults: count => `${count} more result${count === 1 ? "" : "s"} waiting`
  },
  tr: {
    empty: "Bu raund için henüz duyuru yok.",
    moreResults: count => `${count} sonuç daha bekliyor`
  },
  fa: {
    empty: "هنوز اطلاعیه‌ای برای این دور وجود ندارد.",
    moreResults: count => `${count} نتیجه دیگر در انتظار است`
  }
};

const notificationTagTranslations = {
  tr: {
    SYSTEM: "SİSTEM", TRADE: "TİCARET", SKIRMISH: "ÇATIŞMA", ATOMIC: "ATOM",
    ALLIANCE: "İTTİFAK", HOST: "YÖNETİCİ", EVENT: "ETKİNLİK", BANK: "BANKA",
    ROUND: "RAUND", INVEST: "YATIRIM", CARD: "KART", SPY: "CASUS"
  },
  fa: {
    SYSTEM: "سیستم", TRADE: "تجارت", SKIRMISH: "نبرد", ATOMIC: "اتمی",
    ALLIANCE: "ائتلاف", HOST: "میزبان", EVENT: "رویداد", BANK: "بانک",
    ROUND: "دور", INVEST: "سرمایه‌گذاری", CARD: "کارت", SPY: "جاسوس"
  }
};

const notificationExactTranslations = {
  tr: {
    "↩️ Trade proposal rejected. Your reserved offer has been returned.": "↩️ Ticaret teklifi reddedildi. Rezerve teklifiniz iade edildi.",
    "❌ Trade Proposal Rejected by target nation!": "❌ Ticaret teklifi hedef ülke tarafından reddedildi!",
    "❌ Host Rejected your coin purchase request.": "❌ Yönetici coin satın alma isteğinizi reddetti.",
    "⛔ Could not contact the game server for this host action.": "⛔ Bu yönetici işlemi için oyun sunucusuna ulaşılamadı.",
    "⛔ Could not contact the game server for this alliance action.": "⛔ Bu ittifak işlemi için oyun sunucusuna ulaşılamadı.",
    "⛔ Could not contact the game server to reset the table.": "⛔ Masayı sıfırlamak için oyun sunucusuna ulaşılamadı.",
    "🔒 Lock your field investments before marking ready for the next round.": "🔒 Bir sonraki raund için hazır olmadan önce saha yatırımlarınızı kilitleyin.",
    "⚠️ You have used both Field Trade proposals for this round.": "⚠️ Bu raunddaki iki Saha Ticareti teklifinizi de kullandınız.",
    "⚠️ No other seated country is available to trade.": "⚠️ Ticaret yapılabilecek başka bir oturmuş ülke yok.",
    "🔒 Lock your investments before offering a field investment in a trade.": "🔒 Ticarette saha yatırımı teklif etmeden önce yatırımlarınızı kilitleyin.",
    "⚠️ Enter valid offer/request fields and coin amounts.": "⚠️ Geçerli teklif/istek alanları ve coin miktarları girin.",
    "⚠️ Every seated player must lock investments before the Global Condition is drawn.": "⚠️ Küresel Etkinlik çekilmeden önce tüm oturmuş oyuncular yatırımlarını kilitlemelidir.",
    "⚠️ You do not have an active Banker loan to repay.": "⚠️ Geri ödenecek aktif bir Banker krediniz yok.",
    "⚠️ Settle your Banker loan and interest in Player Overview before opening a Field Battle.": "⚠️ Saha Savaşını açmadan önce Oyuncu Genel Bakışı bölümünde Banker kredinizi ve faizini ödeyin.",
    "⚠️ Skirmish combat requires field investments to be locked first!": "⚠️ Çatışma başlatmadan önce saha yatırımlarının kilitlenmesi gerekir!",
    "⚠️ No other seated country is available to attack.": "⚠️ Saldırılabilecek başka bir oturmuş ülke yok.",
    "⚠️ Settle your Banker loan and interest before launching a Field Battle.": "⚠️ Saha Savaşını başlatmadan önce Banker kredinizi ve faizini ödeyin.",
    "⚠️ Select a valid enemy power and battleground field.": "⚠️ Geçerli bir düşman ülkesi ve savaş alanı seçin.",
    "Mega-Merger is unavailable in the Simple Edition.": "Mega-Birleşme Basit Sürümde kullanılamaz.",
    "⚠️ President card requires field investments to be locked first!": "⚠️ Başkan kartı için önce saha yatırımları kilitlenmelidir!",
    "⚠️ No other seated country is available for a merger.": "⚠️ Birleşme yapılabilecek başka bir oturmuş ülke yok.",
    "⚠️ Select at least 1 partner power for the President merger.": "⚠️ Başkan birleşmesi için en az 1 ortak güç seçin.",
    "Counter-Union is unavailable in the Simple Edition.": "Karşı Birlik Basit Sürümde kullanılamaz.",
    "⚠️ Select at least 1 ally to form the Counter-Union.": "⚠️ Karşı Birlik oluşturmak için en az 1 müttefik seçin.",
    "⚠️ Only the alliance initiator may launch one coalition skirmish this round.": "⚠️ Bu raundda koalisyon çatışmasını yalnızca ittifak başlatıcısı başlatabilir.",
    "⚠️ No valid locked solo country or opposing alliance is available to attack.": "⚠️ Saldırılacak geçerli, yatırımları kilitli tek ülke veya karşı ittifak yok.",
    "🏆 This three-round game is complete. Restart the room to begin a new game.": "🏆 Üç raundluk oyun tamamlandı. Yeni oyun için odayı yeniden başlatın.",
    "⛔ Could not contact the game server to reset the table.": "⛔ Masayı sıfırlamak için oyun sunucusuna ulaşılamadı.",
    "↩️ Unresolved trade offer returned before round calculation.": "↩️ Çözülmemiş ticaret teklifi raund hesaplanmadan önce iade edildi.",
    "Banker loans are unavailable in the Simple Edition.": "Banker kredileri Basit Sürümde kullanılamaz.",
    "⚠️ Loan Refused: You must hold and click the Banker card in your hand to take a loan!": "⚠️ Kredi reddedildi: Kredi almak için elinizde Banker kartı olmalı ve karta tıklamalısınız!",
    "⚠️ You need at least 5 unallocated coins to take a Banker loan.": "⚠️ Banker kredisi almak için en az 5 ayrılmamış coin gerekir.",
    "🎖️ General Card Activated! You now have 2 Skirmish Field Attacks for this round.": "🎖️ General kartı etkinleştirildi! Bu raund için artık 2 Saha Çatışması saldırınız var.",
    "🕵️ No current-round trade is available to break.": "🕵️ Bozulabilecek mevcut raund ticareti yok.",
    "🕵️ Spy operation submitted to the server.": "🕵️ Casus operasyonu sunucuya gönderildi.",
    "🕶️ A Hitman disabled one of your proficiency cards this round.": "🕶️ Bir Hitman bu raund uzmanlık kartlarınızdan birini devre dışı bıraktı.",
    "Choose an opposing country to target.": "Hedef alınacak bir rakip ülke seçin.",
    "Choose a valid seated opposing country.": "Geçerli, oturmuş bir rakip ülke seçin.",
    "🦠 Pandemic is active: Atomic Bomb cards are deactivated this round.": "🦠 Pandemi aktif: Atom Bombası kartları bu raund devre dışı.",
    "⚠️ Atomic Bomb requires round investments to be locked first!": "⚠️ Atom Bombası için önce raund yatırımları kilitlenmelidir!",
    "⚠️ No other seated country is available to target.": "⚠️ Hedef alınabilecek başka bir oturmuş ülke yok.",
    "⚠️ Select a target country and field to detonate!": "⚠️ Patlatmak için bir hedef ülke ve saha seçin!"
  },
  fa: {
    "↩️ Trade proposal rejected. Your reserved offer has been returned.": "↩️ پیشنهاد تجارت رد شد. پیشنهاد رزروشده شما برگردانده شد.",
    "❌ Trade Proposal Rejected by target nation!": "❌ پیشنهاد تجارت توسط کشور هدف رد شد!",
    "❌ Host Rejected your coin purchase request.": "❌ میزبان درخواست خرید سکه شما را رد کرد.",
    "⛔ Could not contact the game server for this host action.": "⛔ ارتباط با سرور بازی برای این اقدام میزبان ممکن نشد.",
    "⛔ Could not contact the game server for this alliance action.": "⛔ ارتباط با سرور بازی برای این اقدام ائتلاف ممکن نشد.",
    "⛔ Could not contact the game server to reset the table.": "⛔ ارتباط با سرور بازی برای بازنشانی میز ممکن نشد.",
    "🔒 Lock your field investments before marking ready for the next round.": "🔒 پیش از اعلام آمادگی برای دور بعد، سرمایه‌گذاری‌های زمین را قفل کنید.",
    "⚠️ You have used both Field Trade proposals for this round.": "⚠️ هر دو پیشنهاد تجارت میدانی این دور را استفاده کرده‌اید.",
    "⚠️ No other seated country is available to trade.": "⚠️ کشور نشسته دیگری برای تجارت وجود ندارد.",
    "🔒 Lock your investments before offering a field investment in a trade.": "🔒 پیش از پیشنهاد سرمایه‌گذاری زمین در تجارت، سرمایه‌گذاری‌ها را قفل کنید.",
    "⚠️ Enter valid offer/request fields and coin amounts.": "⚠️ زمین‌ها و مقدار سکه معتبر برای پیشنهاد/درخواست وارد کنید.",
    "⚠️ Every seated player must lock investments before the Global Condition is drawn.": "⚠️ پیش از کشیدن رویداد جهانی، همه بازیکنان نشسته باید سرمایه‌گذاری‌های خود را قفل کنند.",
    "⚠️ You do not have an active Banker loan to repay.": "⚠️ وام فعال Banker برای بازپرداخت ندارید.",
    "⚠️ Settle your Banker loan and interest in Player Overview before opening a Field Battle.": "⚠️ پیش از باز کردن نبرد میدانی، وام و بهره Banker را در نمای بازیکن تسویه کنید.",
    "⚠️ Skirmish combat requires field investments to be locked first!": "⚠️ برای نبرد، ابتدا باید سرمایه‌گذاری‌های زمین قفل شوند!",
    "⚠️ No other seated country is available to attack.": "⚠️ کشور نشسته دیگری برای حمله وجود ندارد.",
    "⚠️ Settle your Banker loan and interest before launching a Field Battle.": "⚠️ پیش از آغاز نبرد میدانی، وام و بهره Banker را تسویه کنید.",
    "⚠️ Select a valid enemy power and battleground field.": "⚠️ یک قدرت دشمن و زمین نبرد معتبر انتخاب کنید.",
    "Mega-Merger is unavailable in the Simple Edition.": "مگاادغام در نسخه ساده در دسترس نیست.",
    "⚠️ President card requires field investments to be locked first!": "⚠️ کارت President نیاز دارد که ابتدا سرمایه‌گذاری‌های زمین قفل شوند!",
    "⚠️ No other seated country is available for a merger.": "⚠️ کشور نشسته دیگری برای ادغام وجود ندارد.",
    "⚠️ Select at least 1 partner power for the President merger.": "⚠️ برای ادغام President حداقل یک قدرت همکار انتخاب کنید.",
    "Counter-Union is unavailable in the Simple Edition.": "اتحاد متقابل در نسخه ساده در دسترس نیست.",
    "⚠️ Select at least 1 ally to form the Counter-Union.": "⚠️ برای تشکیل اتحاد متقابل حداقل یک متحد انتخاب کنید.",
    "⚠️ Only the alliance initiator may launch one coalition skirmish this round.": "⚠️ در این دور فقط آغازکننده ائتلاف می‌تواند نبرد ائتلافی را آغاز کند.",
    "⚠️ No valid locked solo country or opposing alliance is available to attack.": "⚠️ کشور مستقل قفل‌شده یا ائتلاف رقیب معتبری برای حمله وجود ندارد.",
    "🏆 This three-round game is complete. Restart the room to begin a new game.": "🏆 بازی سه‌دوره‌ای تمام شد. برای شروع بازی جدید اتاق را بازنشانی کنید.",
    "⛔ Could not contact the game server to reset the table.": "⛔ ارتباط با سرور بازی برای بازنشانی میز ممکن نشد.",
    "↩️ Unresolved trade offer returned before round calculation.": "↩️ پیشنهاد تجارت حل‌نشده پیش از محاسبه دور برگردانده شد.",
    "Banker loans are unavailable in the Simple Edition.": "وام‌های Banker در نسخه ساده در دسترس نیستند.",
    "⚠️ Loan Refused: You must hold and click the Banker card in your hand to take a loan!": "⚠️ وام رد شد: برای دریافت وام باید کارت Banker را در دست داشته و روی آن کلیک کنید!",
    "⚠️ You need at least 5 unallocated coins to take a Banker loan.": "⚠️ برای دریافت وام Banker حداقل ۵ سکه تخصیص‌نیافته لازم است.",
    "🎖️ General Card Activated! You now have 2 Skirmish Field Attacks for this round.": "🎖️ کارت General فعال شد! اکنون برای این دور ۲ حمله نبرد میدانی دارید.",
    "🕵️ No current-round trade is available to break.": "🕵️ تجارت فعالی از این دور برای مختل کردن وجود ندارد.",
    "🕵️ Spy operation submitted to the server.": "🕵️ عملیات جاسوسی به سرور ارسال شد.",
    "🕶️ A Hitman disabled one of your proficiency cards this round.": "🕶️ یک هیتمن یکی از کارت‌های مهارت شما را در این دور غیرفعال کرد.",
    "Choose an opposing country to target.": "یک کشور رقیب برای هدف‌گیری انتخاب کنید.",
    "Choose a valid seated opposing country.": "یک کشور رقیب نشسته و معتبر انتخاب کنید.",
    "🦠 Pandemic is active: Atomic Bomb cards are deactivated this round.": "🦠 همه‌گیری فعال است: کارت‌های بمب اتم در این دور غیرفعال هستند.",
    "⚠️ Atomic Bomb requires round investments to be locked first!": "⚠️ برای بمب اتم ابتدا باید سرمایه‌گذاری‌های دور قفل شوند!",
    "⚠️ No other seated country is available to target.": "⚠️ کشور نشسته دیگری برای هدف‌گیری وجود ندارد.",
    "⚠️ Select a target country and field to detonate!": "⚠️ برای انفجار، کشور و زمین هدف را انتخاب کنید!"
  }
};

function notificationCopy() {
  return notificationUiCopy[currentLang] || notificationUiCopy.en;
}

function localizeNotificationTag(tag) {
  return notificationTagTranslations[currentLang]?.[tag] || tag;
}

function fieldNotificationLabel(field) {
  const labels = currentLang === "tr"
    ? { agri: "TARIM", oil: "PETROL", mines: "MADEN", unallocated: "ayrılmamış bakiye" }
    : currentLang === "fa"
      ? { agri: "کشاورزی", oil: "نفت", mines: "معادن", unallocated: "موجودی تخصیص‌نیافته" }
      : { agri: "AGRI", oil: "OIL", mines: "MINES", unallocated: "unallocated balance" };
  return labels[field?.toLowerCase()] || field;
}

function localizeNotificationMessage(message) {
  if (!message || currentLang === "en") return message;
  const exact = notificationExactTranslations[currentLang]?.[message];
  if (exact) return exact;
  let match;

  if ((match = message.match(/^🕶️ Hitman action: (.+) disabled one proficiency card held by (.+)\.$/))) {
    return currentLang === "tr"
      ? `🕶️ Hitman eylemi: ${match[2]} tarafından tutulan bir uzmanlık kartı ${match[1]} tarafından devre dışı bırakıldı.`
      : `🕶️ اقدام هیتمن: یک کارت مهارت متعلق به ${match[2]} توسط ${match[1]} غیرفعال شد.`;
  }
  if ((match = message.match(/^🕶️ Hitman action: (.+) targeted (.+), but no matching card was found\.$/))) {
    return currentLang === "tr"
      ? `🕶️ Hitman eylemi: ${match[1]} ${match[2]} ülkesini hedef aldı, ancak eşleşen kart bulunamadı.`
      : `🕶️ اقدام هیتمن: ${match[1]} کشور ${match[2]} را هدف گرفت، اما کارت منطبقی پیدا نشد.`;
  }
  if ((match = message.match(/^🕶️ Hitman success: (.+) had the (General|Spy) card\. It was disabled\.$/))) {
    return currentLang === "tr"
      ? `🕶️ Hitman başarılı: ${match[1]} ülkesinde ${match[2]} kartı vardı. Kart devre dışı bırakıldı.`
      : `🕶️ هیتمن موفق بود: کشور ${match[1]} کارت ${match[2]} را داشت. کارت غیرفعال شد.`;
  }
  if ((match = message.match(/^🕶️ Hitman failed: (.+) did not have the (General|Spy) card\.$/))) {
    return currentLang === "tr"
      ? `🕶️ Hitman başarısız: ${match[1]} ülkesinde ${match[2]} kartı yoktu.`
      : `🕶️ هیتمن ناموفق بود: کشور ${match[1]} کارت ${match[2]} را نداشت.`;
  }
  if ((match = message.match(/^🌐 Language changed to (.+)\.$/))) {
    return currentLang === "tr" ? `🌐 Dil ${match[1]} olarak değiştirildi.` : `🌐 زبان به ${match[1]} تغییر کرد.`;
  }
  if ((match = message.match(/^💥 SKIRMISH DEFEAT! (.+) invaded your (.+) field! Lost all (.+) invested coins!$/))) {
    return currentLang === "tr"
      ? `💥 ÇATIŞMA YENİLGİSİ! ${match[1]} ${fieldNotificationLabel(match[2])} sahanızı işgal etti! Yatırılmış ${match[3]} coin kaybedildi!`
      : `💥 شکست نبرد! ${match[1]} به زمین ${fieldNotificationLabel(match[2])} شما حمله کرد! همه ${match[3]} سکه سرمایه‌گذاری‌شده از دست رفت!`;
  }
  if ((match = message.match(/^☢️ ATOMIC STRIKE! (.+) destroyed (.+) Coins in your (.+) field\.$/))) {
    return currentLang === "tr"
      ? `☢️ ATOM SALDIRISI! ${match[1]}, ${fieldNotificationLabel(match[3])} sahanızdaki ${match[2]} coin'i yok etti.`
      : `☢️ حمله اتمی! ${match[1]} در زمین ${fieldNotificationLabel(match[3])} شما ${match[2]} سکه را نابود کرد.`;
  }
  if ((match = message.match(/^❌ Alliance Proposal Rejected by (.+)! Alliance cancelled\.$/))) {
    return currentLang === "tr" ? `❌ İttifak teklifi ${match[1]} tarafından reddedildi! İttifak iptal edildi.` : `❌ پیشنهاد ائتلاف توسط ${match[1]} رد شد! ائتلاف لغو شد.`;
  }
  if ((match = message.match(/^👑 Host dealt and locked 2 proficiency cards for Round (.+)!$/))) {
    return currentLang === "tr" ? `👑 Yönetici Raund ${match[1]} için 2 uzmanlık kartı dağıtıp kilitledi!` : `👑 میزبان ۲ کارت مهارت را برای دور ${match[1]} توزیع و قفل کرد!`;
  }
  if ((match = message.match(/^🎲 Host drawn Global Event Card: (.+)!$/))) {
    return currentLang === "tr" ? `🎲 Yönetici Küresel Etkinlik kartını çekti: ${match[1]}!` : `🎲 میزبان کارت رویداد جهانی را کشید: ${match[1]}!`;
  }
  if ((match = message.match(/^✅ Host Approved your coin purchase! Your server wallet now holds (.+) coins\.$/))) {
    return currentLang === "tr" ? `✅ Yönetici coin satın almanızı onayladı! Sunucu cüzdanınızda artık ${match[1]} coin var.` : `✅ میزبان خرید سکه شما را تأیید کرد! کیف پول سرور شما اکنون ${match[1]} سکه دارد.`;
  }
  if ((match = message.match(/^🏦 Banker loan settled: (.+) coins paid, including interest\.$/))) {
    return currentLang === "tr" ? `🏦 Banker kredisi kapatıldı: faiz dahil ${match[1]} coin ödendi.` : `🏦 وام Banker تسویه شد: ${match[1]} سکه شامل بهره پرداخت شد.`;
  }
  if ((match = message.match(/^⛔ Only the room creator can (.+)\.$/))) {
    return currentLang === "tr" ? `⛔ Bu işlemi yalnızca oda oluşturucusu yapabilir: ${match[1]}.` : `⛔ فقط سازنده اتاق می‌تواند این کار را انجام دهد: ${match[1]}.`;
  }
  if ((match = message.match(/^Welcome (.+)! Your wallet is synchronized with the game server\.$/))) {
    return currentLang === "tr" ? `${match[1]} hoş geldiniz! Cüzdanınız oyun sunucusuyla senkronize edildi.` : `به بازی خوش آمدید ${match[1]}! کیف پول شما با سرور بازی همگام شد.`;
  }
  if ((match = message.match(/^🏁 You marked yourself READY to close Round (.+)\.$/))) {
    return currentLang === "tr" ? `🏁 Raund ${match[1]} kapanışı için HAZIR olduğunuzu belirttiniz.` : `🏁 خود را برای بستن دور ${match[1]} آماده اعلام کردید.`;
  }
  if ((match = message.match(/^🔄 You CANCELLED your ready status for Round (.+)\.$/))) {
    return currentLang === "tr" ? `🔄 آمادگی خود برای بستن Raund ${match[1]} را لغو کردید.` : `🔄 وضعیت آمادگی خود برای دور ${match[1]} را لغو کردید.`;
  }
  if ((match = message.match(/^🤝 Sent a server-validated trade proposal to (.+)\.$/))) {
    return currentLang === "tr" ? `🤝 ${match[1]} ülkesine sunucu doğrulamalı ticaret teklifi gönderildi.` : `🤝 پیشنهاد تجارت تأییدشده توسط سرور به ${match[1]} ارسال شد.`;
  }
  if ((match = message.match(/^⚠️ Trade could not settle: (.+) Coins are required from your (.+) field\.$/))) {
    return currentLang === "tr" ? `⚠️ Ticaret sonuçlandırılamadı: ${match[1]} coin ${fieldNotificationLabel(match[2])} sahanızdan gerekli.` : `⚠️ تجارت تسویه نشد: ${match[1]} سکه از زمین ${fieldNotificationLabel(match[2])} شما لازم است.`;
  }
  if ((match = message.match(/^🌍 Global Condition applied to trade — (.+) Coins\.$/))) {
    return currentLang === "tr" ? `🌍 Ticaret için Küresel Etkinlik uygulandı — ${match[1]} coin.` : `🌍 رویداد جهانی بر تجارت اعمال شد — ${match[1]} سکه.`;
  }
  if ((match = message.match(/^🤝 TRADE EXECUTED with (.+)! Exchanged assets successfully\.$/))) {
    return currentLang === "tr" ? `🤝 ${match[1]} ile TİCARET GERÇEKLEŞTİ! Varlıklar başarıyla takas edildi.` : `🤝 تجارت با ${match[1]} انجام شد! دارایی‌ها با موفقیت مبادله شدند.`;
  }
  if ((match = message.match(/^❌ You rejected the trade proposal from (.+)\.$/))) {
    return currentLang === "tr" ? `❌ ${match[1]} ülkesinin ticaret teklifini reddettiniz.` : `❌ پیشنهاد تجارت ${match[1]} را رد کردید.`;
  }
  if ((match = message.match(/^🛑 Request limit reached: you can make up to (.+) coin purchase requests per game\.$/))) {
    return currentLang === "tr" ? `🛑 İstek sınırına ulaşıldı: oyun başına en fazla ${match[1]} coin satın alma isteği yapabilirsiniz.` : `🛑 به سقف درخواست رسیدید: در هر بازی حداکثر ${match[1]} درخواست خرید سکه می‌توانید ثبت کنید.`;
  }
  if ((match = message.match(/^🛑 Purchase Capped: Approved coins and pending requests cannot exceed (.+) coins\.$/))) {
    return currentLang === "tr" ? `🛑 Satın alma sınırı: onaylanan coinler ve bekleyen istekler ${match[1]} coin'i aşamaz.` : `🛑 سقف خرید: سکه‌های تأییدشده و درخواست‌های معلق نمی‌توانند از ${match[1]} سکه بیشتر شوند.`;
  }
  if ((match = message.match(/^⏳ Coin Purchase Request submitted! Waiting for Host Approval \(\+100 Coins\)\.\.\.$/))) {
    return currentLang === "tr" ? "⏳ Coin satın alma isteği gönderildi! Yönetici onayı bekleniyor (+100 Coin)..." : "⏳ درخواست خرید سکه ارسال شد! در انتظار تأیید میزبان (+۱۰۰ سکه)...";
  }
  if ((match = message.match(/^⚠️ Loan repayment requires (.+) total wallet coins; you need (.+) more\.$/))) {
    return currentLang === "tr" ? `⚠️ Kredi geri ödemesi için toplam ${match[1]} cüzdan coin'i gerekir; ${match[2]} coin daha eksik.` : `⚠️ بازپرداخت وام به ${match[1]} سکه در کیف پول نیاز دارد؛ ${match[2]} سکه دیگر لازم است.`;
  }
  if ((match = message.match(/^✅ Locked field investments: Agri\((.+)\), Oil\((.+)\), Mines\((.+)\)\.$/))) {
    return currentLang === "tr" ? `✅ Saha yatırımları kilitlendi: Tarım(${match[1]}), Petrol(${match[2]}), Maden(${match[3]}).` : `✅ سرمایه‌گذاری‌های زمین قفل شد: کشاورزی(${match[1]})، نفت(${match[2]})، معادن(${match[3]}).`;
  }
  if ((match = message.match(/^⚠️ Attack Limit Reached: You have used all \((.+)\) skirmish attacks for this round\.$/))) {
    return currentLang === "tr" ? `⚠️ Saldırı sınırına ulaşıldı: bu raunddaki tüm (${match[1]}) çatışma saldırısını kullandınız.` : `⚠️ به سقف حمله رسیدید: همه ${match[1]} حمله نبرد این دور را استفاده کرده‌اید.`;
  }
  if ((match = message.match(/^🏛️ Sent President Mega-Merger proposal to (.+)\. Waiting for approval\.\.\.$/))) {
    return currentLang === "tr" ? `🏛️ Başkan Mega-Birleşme teklifi ${match[1]} ülkesine gönderildi. Onay bekleniyor...` : `🏛️ پیشنهاد مگاادغام President به ${match[1]} ارسال شد. در انتظار تأیید...`;
  }
  if ((match = message.match(/^🛡️ Sent Defensive Counter-Union proposal to (.+)\. Waiting for approval\.\.\.$/))) {
    return currentLang === "tr" ? `🛡️ پیشنهاد دفاعی اتحاد متقابل به ${match[1]} ارسال شد. در انتظار تأیید...` : `🛡️ پیشنهاد اتحاد متقابل دفاعی به ${match[1]} ارسال شد. در انتظار تأیید...`;
  }
  if ((match = message.match(/^🤝 ALLIANCE MUTUALLY APPROVED! Active powers: (.+)\.$/))) {
    return currentLang === "tr" ? `🤝 İTTİFAK KARŞILIKLI ONAYLANDI! Aktif güçler: ${match[1]}.` : `🤝 ائتلاف به‌طور متقابل تأیید شد! قدرت‌های فعال: ${match[1]}.`;
  }
  if ((match = message.match(/^✅ You accepted the (.+)\. Awaiting final confirmation from the proposal initiator\.\.\.$/))) {
    return currentLang === "tr" ? `✅ ${match[1]} teklifini kabul ettiniz. Teklifi başlatanın son onayı bekleniyor...` : `✅ پیشنهاد ${match[1]} را پذیرفتید. در انتظار تأیید نهایی آغازکننده پیشنهاد...`;
  }
  if ((match = message.match(/^❌ You REJECTED the (.+) proposal!$/))) {
    return currentLang === "tr" ? `❌ ${match[1]} teklifini REDDETTİNİZ!` : `❌ پیشنهاد ${match[1]} را رد کردید!`;
  }
  if ((match = message.match(/^⛔ Round cannot advance yet: (.+)\.$/))) {
    return currentLang === "tr" ? `⛔ Raund henüz ilerleyemez: ${match[1]}.` : `⛔ دور هنوز نمی‌تواند جلو برود: ${match[1]}.`;
  }
  if ((match = message.match(/^Activated (.+)!$/))) {
    return currentLang === "tr" ? `${match[1]} etkinleştirildi!` : `${match[1]} فعال شد!`;
  }
  if ((match = message.match(/^(.+) is unavailable in the Simple Edition\.$/))) {
    return currentLang === "tr" ? `${match[1]} Basit Sürümde kullanılamaz.` : `${match[1]} در نسخه ساده در دسترس نیست.`;
  }
  if ((match = message.match(/^(.+) and (.+) completed their exchange\.$/))) {
    return currentLang === "tr" ? `${match[1]} ve ${match[2]} takaslarını tamamladı.` : `${match[1]} و ${match[2]} مبادله خود را کامل کردند.`;
  }
  if ((match = message.match(/^(.+) declined the trade from (.+)\.$/))) {
    return currentLang === "tr" ? `${match[1]} ülkesi ${match[2]} ülkesinden gelen ticareti reddetti.` : `کشور ${match[1]} تجارت پیشنهادی ${match[2]} را رد کرد.`;
  }
  if ((match = message.match(/^(.+) could not complete the trade with (.+)\.$/))) {
    return currentLang === "tr" ? `${match[1]} ülkesi ${match[2]} ile ticareti tamamlayamadı.` : `کشور ${match[1]} نتوانست تجارت با ${match[2]} را کامل کند.`;
  }
  if ((match = message.match(/^(.+) broke the finalized trade between (.+) and (.+)\.$/))) {
    return currentLang === "tr" ? `${match[1]} ülkesi ${match[2]} ve ${match[3]} arasındaki kesinleşmiş ticareti bozdu.` : `کشور ${match[1]} تجارت نهایی‌شده بین ${match[2]} و ${match[3]} را مختل کرد.`;
  }
  if ((match = message.match(/^(.+) cancelled the pending trade between (.+) and (.+)\.$/))) {
    return currentLang === "tr" ? `${match[1]} ülkesi ${match[2]} ve ${match[3]} arasındaki bekleyen ticareti iptal etti.` : `کشور ${match[1]} تجارت معلق بین ${match[2]} و ${match[3]} را لغو کرد.`;
  }
  if ((match = message.match(/^(.+) and (.+) tied over (.+)\.$/))) {
    return currentLang === "tr" ? `${match[1]} ve ${match[2]} ${match[3]} sahasında berabere kaldı.` : `${match[1]} و ${match[2]} بر سر ${match[3]} به تساوی رسیدند.`;
  }
  if ((match = message.match(/^(.+) won the (.+) (coalition )?(battle|skirmish)\.$/))) {
    return currentLang === "tr" ? `${match[1]} ${match[2]} koalisyon çatışmasını kazandı.` : `${match[1]} نبرد ائتلافی ${match[2]} را برد.`;
  }
  if ((match = message.match(/^Attack power: (.+) · Defense power: (.+) · (.+) (Coins|field resources) transferred\.$/))) {
    return currentLang === "tr"
      ? `Saldırı gücü: ${match[1]} · Savunma gücü: ${match[2]} · ${match[3]} ${match[4] === "Coins" ? "coin" : "saha kaynağı"} aktarıldı.`
      : `قدرت حمله: ${match[1]} · قدرت دفاع: ${match[2]} · ${match[3]} ${match[4] === "Coins" ? "سکه" : "منبع زمین"} منتقل شد.`;
  }
  if (message === "Server wallet balances have been updated.") {
    return currentLang === "tr" ? "Sunucu cüzdan bakiyeleri güncellendi." : "موجودی کیف پول‌های سرور به‌روزرسانی شد.";
  }
  if (message === "No server wallet balances changed.") {
    return currentLang === "tr" ? "Sunucu cüzdan bakiyeleri değişmedi." : "موجودی کیف پول‌های سرور تغییری نکرد.";
  }
  if (message === "The proposer’s reserved offer has been returned.") {
    return currentLang === "tr" ? "Teklif sahibinin rezerve teklifi iade edildi." : "پیشنهاد رزروشده پیشنهاددهنده برگردانده شد.";
  }
  if (message === "Both countries' trade assets were restored to their pre-trade state.") {
    return currentLang === "tr" ? "İki ülkenin ticaret varlıkları işlem öncesi durumuna getirildi." : "دارایی‌های تجاری هر دو کشور به وضعیت پیش از تجارت بازگردانده شد.";
  }
  if (message === "The proposer’s escrowed asset was returned.") {
    return currentLang === "tr" ? "Teklif sahibinin emanetteki varlığı iade edildi." : "دارایی امانی پیشنهاددهنده برگردانده شد.";
  }
  if (message === "A new Global Condition applies to this round.") {
    return currentLang === "tr" ? "Bu raund için yeni bir Küresel Etkinlik geçerli." : "یک رویداد جهانی جدید در این دور اعمال می‌شود.";
  }
  if (message === "This condition was drawn automatically after every seated commander locked investments.") {
    return currentLang === "tr" ? "Bu etkinlik, tüm oturmuş komutanlar yatırımlarını kilitledikten sonra otomatik olarak çekildi." : "این رویداد پس از قفل شدن سرمایه‌گذاری همه فرماندهان به‌طور خودکار کشیده شد.";
  }
  if ((match = message.match(/^Shared resources: 🌾 (.+) · 🛢️ (.+) · ⛏️ (.+)\.$/))) {
    return currentLang === "tr" ? `Paylaşılan kaynaklar: 🌾 ${match[1]} · 🛢️ ${match[2]} · ⛏️ ${match[3]}.` : `منابع مشترک: 🌾 ${match[1]} · 🛢️ ${match[2]} · ⛏️ ${match[3]}.`;
  }
  if ((match = message.match(/^(.+) has formed an alliance\.$/))) {
    return currentLang === "tr" ? `${match[1]} bir ittifak kurdu.` : `${match[1]} یک ائتلاف تشکیل داده‌اند.`;
  }
  if ((match = message.match(/^☢️ Atomic Strike submitted to the server against (.+)\.$/))) {
    return currentLang === "tr" ? `☢️ ${match[1]} ülkesine karşı Atom Saldırısı sunucuya gönderildi.` : `☢️ حمله اتمی علیه ${match[1]} به سرور ارسال شد.`;
  }
  return message;
}

function localizeGameResult(result) {
  if (!result || currentLang === "en") return result;
  const localized = { ...result };
  const tr = currentLang === "tr";
  const translate = {
    "ALLIANCE SKIRMISH": tr ? "İTTİFAK ÇATIŞMASI" : "نبرد ائتلافی",
    "SKIRMISH RESULT": tr ? "ÇATIŞMA SONUCU" : "نتیجه نبرد",
    "FINAL ROUND COMPLETE": tr ? "SON RAUND TAMAMLANDI" : "دور نهایی کامل شد",
    "ROUND COMPLETE": tr ? "RAUND TAMAMLANDI" : "دور کامل شد",
    "NEW ROUND": tr ? "YENİ RAUND" : "دور جدید",
    "GLOBAL CONDITION": tr ? "KÜRESEL ETKİNLİK" : "رویداد جهانی",
    "GAME COMPLETE": tr ? "OYUN TAMAMLANDI" : "بازی کامل شد",
    "ATOMIC BOMB RESULT": tr ? "ATOM BOMBASI SONUCU" : "نتیجه بمب اتم",
    "TRADE RESULT": tr ? "TİCARET SONUCU" : "نتیجه تجارت",
    "SPY CARD RESULT": tr ? "CASUS KARTI SONUCU" : "نتیجه کارت جاسوس",
    "PRESIDENT MERGER RESULT": tr ? "BAŞKAN BİRLEŞMESİ SONUCU" : "نتیجه ادغام President",
    "UNION MERGER RESULT": tr ? "BİRLİK BİRLEŞMESİ SONUCU" : "نتیجه ادغام اتحاد"
  };
  if (translate[localized.category]) localized.category = translate[localized.category];

  const titles = tr
    ? {
      "Alliance Skirmish Victory": "İttifak Çatışması Zaferi", "Alliance Skirmish Defeat": "İttifak Çatışması Yenilgisi", "Alliance Skirmish Stalemate": "İttifak Çatışması Beraberliği",
      "Skirmish Victory": "Çatışma Zaferi", "Skirmish Defeat": "Çatışma Yenilgisi", "Skirmish Stalemate": "Çatışma Beraberliği",
      "Round Update": "Raund Güncellemesi", "Atomic Strike Detonated": "Atom Saldırısı Patlatıldı", "Trade Completed": "Ticaret Tamamlandı", "Trade Rejected": "Ticaret Reddedildi",
      "Spy Operation Successful": "Casus Operasyonu Başarılı", "President Mega-Merger Formed": "Başkan Mega-Birleşmesi Kuruldu", "Counter-Union Formed": "Karşı Birlik Kuruldu",
      "President Merger Rejected": "Başkan Birleşmesi Reddedildi", "Counter-Union Rejected": "Karşı Birlik Reddedildi", "Three Rounds Complete": "Üç Raund Tamamlandı"
    }
    : {
      "Alliance Skirmish Victory": "پیروزی نبرد ائتلافی", "Alliance Skirmish Defeat": "شکست نبرد ائتلافی", "Alliance Skirmish Stalemate": "بن‌بست نبرد ائتلافی",
      "Skirmish Victory": "پیروزی نبرد", "Skirmish Defeat": "شکست نبرد", "Skirmish Stalemate": "بن‌بست نبرد",
      "Round Update": "به‌روزرسانی دور", "Atomic Strike Detonated": "حمله اتمی منفجر شد", "Trade Completed": "تجارت کامل شد", "Trade Rejected": "تجارت رد شد",
      "Spy Operation Successful": "عملیات جاسوسی موفق بود", "President Mega-Merger Formed": "مگاادغام President تشکیل شد", "Counter-Union Formed": "اتحاد متقابل تشکیل شد",
      "President Merger Rejected": "ادغام President رد شد", "Counter-Union Rejected": "اتحاد متقابل رد شد", "Three Rounds Complete": "سه دور کامل شد"
    };
  if (titles[localized.title]) localized.title = titles[localized.title];
  localized.summary = localizeNotificationMessage(localized.summary);
  localized.details = localizeNotificationMessage(localized.details);

  let match;
  if ((match = String(result.title || "").match(/^Round (\d+) Complete$/))) {
    localized.title = tr ? `Raund ${match[1]} Tamamlandı` : `دور ${match[1]} کامل شد`;
  } else if ((match = String(result.title || "").match(/^Round (\d+) Started$/))) {
    localized.title = tr ? `Raund ${match[1]} Başladı` : `دور ${match[1]} آغاز شد`;
  }
  if ((match = String(result.summary || "").match(/^Round (\d+) has been settled for every commander\.$/))) {
    localized.summary = tr ? `Raund ${match[1]} tüm komutanlar için sonuçlandırıldı.` : `دور ${match[1]} برای همه فرماندهان تسویه شد.`;
  } else if ((match = String(result.summary || "").match(/^Round (\d+) is now open\.$/))) {
    localized.summary = tr ? `Raund ${match[1]} artık açık.` : `دور ${match[1]} اکنون باز است.`;
  }
  return localized;
}

window.changeLanguage = function(lang) {
  if (!translations[lang]) return;
  currentLang = lang;

  try {
    localStorage.setItem("selected_lang", lang);
  } catch (e) {}

  const dict = translations[lang];

  for (const [id, text] of Object.entries(dict)) {
    const dashedId = id.replace(/([A-Z])/g, "-$1").toLowerCase();
    const el = document.getElementById(dashedId);
    if (el) {
      el.textContent = text;
    }
  }

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  document.querySelector(".round-progress")?.setAttribute("aria-label", dict.ariaRoundProgress);
  document.querySelector(".status-metrics")?.setAttribute("aria-label", dict.ariaCommanderSummary);
  document.querySelector(".game-tabs")?.setAttribute("aria-label", dict.ariaGameTabs);
  document.getElementById("round-readiness-meter")?.setAttribute("aria-label", dict.ariaRoundReadiness);
  document.getElementById("command-board-surface")?.setAttribute("aria-label", dict.ariaCommandBoard);
  syncEditionTitle();

  if (lang === "fa") {
    document.body.style.direction = "rtl";
  } else {
    document.body.style.direction = "ltr";
  }

  syncHostButtonsUI();
  updateReadyConsensusUI();
  updateLoanCalculator();
  renderRoundSettlement();
  updateAllianceUI();
  renderCommandBoard();
  syncCommanderStatus();
  syncCoinPurchaseControl();
  if (activeGlobalCondition) {
    activeGlobalCondition = describeGlobalCondition(activeGlobalCondition);
    renderActiveGlobalCondition();
  }
  renderRoundAnnouncements();
  document.getElementById("btn-dismiss-game-result")?.replaceChildren(dict.txtGameResultContinue || "Continue");
  if (activeGameResultAlert) {
    const displayResult = localizeGameResult(activeGameResultAlert);
    setTxt("game-result-eyebrow", displayResult.category || "GAME RESULT");
    setTxt("game-result-title", displayResult.title || "Round Update");
    setTxt("game-result-summary", displayResult.summary || "");
    setTxt("game-result-details", displayResult.details || "");
    setTxt(
      "game-result-queue-status",
      gameResultAlertQueue.length > 0 ? notificationCopy().moreResults(gameResultAlertQueue.length) : ""
    );
  }
  logAction(`🌐 Language changed to ${lang.toUpperCase()}.`, "SYSTEM");
};

// Multi-Tab Broadcast Sync Engine
const gameBroadcast = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("world_war_game_channel") : null;

if (gameBroadcast) {
  gameBroadcast.onmessage = (event) => {
    const data = event.data;
    if (data.type === "LOG_ENTRY") {
      if (data.payload?.round === currentRound) {
        gameActivityLedger.unshift(data.payload);
        renderRoundAnnouncements();
      }
    } else if (data.type === "GAME_RESULT") {
      queueGameResultAlert(data.payload);
    } else if (data.type === "PLAYER_READY_STATUS") {
      if (data.payload.isReady) {
        readyPlayersSet.add(cleanStr(data.payload.country));
      } else {
        readyPlayersSet.delete(cleanStr(data.payload.country));
      }
      updateReadyConsensusUI();
    } else if (data.type === "PLAYER_INVESTMENTS_LOCKED") {
      if (data.payload?.round !== currentRound) return;
      const country = cleanStr(data.payload.country);
      if (data.payload.locked) {
        lockedPlayersSet.add(country);
      } else {
        lockedPlayersSet.delete(country);
      }
      updateReadyConsensusUI();
    } else if (data.type === "PROPOSE_TRADE") {
      pendingTradeProposal = data.payload;
      updateAllianceUI();
    } else if (data.type === "EXECUTE_TRADE") {
      if (assignedCountry && cleanStr(data.payload.proposerCountry) === cleanStr(assignedCountry.name)) {
        applyTradeTransfer("unallocated", data.payload.requestedField, 0, data.payload.requestedAmount);
        pendingOutgoingTrade = null;
      }
      pendingTradeProposal = null;
      updateAllianceUI();
    } else if (data.type === "REJECT_TRADE") {
      const proposalId = data.payload?.proposalId;
      if (pendingOutgoingTrade && (!proposalId || pendingOutgoingTrade.proposalId === proposalId)) {
        refundTradeEscrow(pendingOutgoingTrade);
        pendingOutgoingTrade = null;
        logAction("↩️ Trade proposal rejected. Your reserved offer has been returned.", "TRADE");
      }
      pendingTradeProposal = null;
      updateAllianceUI();
      logAction(`❌ Trade Proposal Rejected by target nation!`, "TRADE");
    } else if (data.type === "REQUEST_COINS") {
      pendingCoinRequests.push(data.payload);
      if (
        assignedCountry &&
        cleanStr(data.payload?.country) === cleanStr(assignedCountry.name) &&
        Number.isFinite(Number(data.payload?.requestCount))
      ) {
        coinRequestsUsed = Number(data.payload.requestCount);
      }
      renderHostCoinRequests();
      syncCoinPurchaseControl();
    } else if (data.type === "SKIRMISH_DEFEAT") {
      if (assignedCountry && cleanStr(data.payload.targetCountry) === cleanStr(assignedCountry.name)) {
        const fieldName = data.payload.targetField;
        const seizedAmount = investments[fieldName] || 0;

        investments[fieldName] = 0; // State changed
        coins = Math.max(0, coins - seizedAmount);

        // Push state directly to slider UI
        const slider = document.getElementById(`slider-${fieldName}`);
        if(slider) slider.value = 0;

        updateUI();
        logAction(`💥 SKIRMISH DEFEAT! ${data.payload.attackerCountry} invaded your ${fieldName.toUpperCase()} field! Lost all ${seizedAmount} invested coins!`, "SKIRMISH");
      }
    } else if (data.type === "ATOMIC_STRIKE") {
      if (assignedCountry && cleanStr(data.payload.targetCountry) === cleanStr(assignedCountry.name)) {
        const fieldName = data.payload.targetField;
        const destroyedAmount = Number(data.payload.destroyed) || 0;
        const remainingAmount = Number(data.payload.remaining);
        investments[fieldName] = Number.isFinite(remainingAmount)
          ? remainingAmount
          : Math.max(0, (investments[fieldName] || 0) - destroyedAmount);

        const slider = document.getElementById(`slider-${fieldName}`);
        if (slider) slider.value = investments[fieldName];

        updateUI();
        logAction(`☢️ ATOMIC STRIKE! ${data.payload.attackerCountry} destroyed ${destroyedAmount} Coins in your ${fieldName.toUpperCase()} field.`, "ATOMIC");
      }
    } else if (data.type.endsWith("_ALLIANCE")) {
      handleAllianceRoomEvent(data);
    }
  };
}

let countryMultipliers = { agri: 1, oil: 1, mines: 1 };
let roundResourceMultipliers = {};
let investments = { agri: 0, oil: 0, mines: 0 };
let activeRoomPlayers = [];
let pendingServerTrades = [];
let fieldTradeAttemptsUsed = 0;
let coinRequestsUsed = 0;
let activeGameTab = "status";
let lastAutoGamePhase = null;
let gameTabsInitialized = false;
const fieldTradeAttemptLimit = 2;
let hostPollInFlight = false;
let selectedBoardCountry = "";
let commandBoardStateSignature = "";

function liveCountryNames(excludeSelf = false) {
  const selfCountry = cleanStr(assignedCountry?.name || "");
  return activeRoomPlayers
    .map(player => player.country)
    .filter(country => country && (!excludeSelf || cleanStr(country) !== selfCountry));
}

function isPrepareCompleteForAct() {
  return !gameFinished &&
    investmentsLocked &&
    eventDrawnThisRound &&
    lockedPlayersSet.size >= registeredPlayersCount;
}

function isActPhaseReady() {
  return isPrepareCompleteForAct() && !isLocalPlayerReadyToClose;
}

function actActionLockMessage() {
  const copy = translations[currentLang] || translations.en;
  return isPrepareCompleteForAct() ? copy.txtActReviewLocked : copy.txtActActionsLocked;
}

function requireActPhase() {
  if (isActPhaseReady()) return true;
  logAction(actActionLockMessage(), "SYSTEM");
  return false;
}

function activeCountryCard(country) {
  return countryCards.find(card => cleanStr(card.name) === cleanStr(country));
}

function setGameTabBadge(tabName, text) {
  const badge = document.getElementById(`tab-${tabName}-badge`);
  if (!badge) return;
  badge.textContent = text || "";
  badge.classList.toggle("hidden", !text);
}

function gameTabActionCount() {
  return Math.max(0, fieldTradeAttemptLimit - fieldTradeAttemptsUsed)
    + Math.max(0, skirmishMaxAllowedAttacks - skirmishAttacksExecuted);
}

function syncGameTabBadges(phase) {
  const copy = translations[currentLang] || translations.en;
  const hasPendingProposal = Boolean(pendingTradeProposal || pendingAllianceProposal);

  setGameTabBadge("status", hasPendingProposal ? copy.txtTabPending : "");
  setGameTabBadge(
    "prepare",
    phase === "prepare"
      ? copy.txtTabNow
      : investmentsLocked
        ? copy.txtTabDone
        : ""
  );
  setGameTabBadge(
    "act",
    hasPendingProposal
      ? copy.txtTabPending
      : phase === "act"
        ? copy.txtTabActions.replace("{count}", gameTabActionCount())
        : ""
  );
  setGameTabBadge(
    "review",
    isLocalPlayerReadyToClose
      ? copy.txtTabReady
      : phase === "review"
        ? copy.txtTabOpen
        : gameFinished
          ? copy.txtTabDone
          : ""
  );
}

window.selectGameTab = function(tabName, shouldFocus = false) {
  const validTabs = ["status", "prepare", "act", "review"];
  if (!validTabs.includes(tabName)) return;

  const tab = document.getElementById(`tab-${tabName}`);
  const panel = document.getElementById(`tab-panel-${tabName}`);
  if (!tab || !panel) return;

  activeGameTab = tabName;
  document.querySelectorAll(".game-tab").forEach(button => {
    const isActive = button === tab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
  document.querySelectorAll(".game-tab-panel").forEach(panelElement => {
    const isActive = panelElement === panel;
    panelElement.classList.toggle("is-active", isActive);
    panelElement.hidden = !isActive;
    panelElement.setAttribute("aria-hidden", String(!isActive));
  });

  if (shouldFocus) tab.focus();
};

function initializeGameTabs() {
  const tablist = document.querySelector(".game-tabs");
  if (!tablist || gameTabsInitialized) return;

  gameTabsInitialized = true;
  tablist.addEventListener("keydown", event => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    else nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;

    selectGameTab(tabs[nextIndex].dataset.gameTab, true);
  });

  selectGameTab(activeGameTab);
}

function getCountryRoundMultipliers(country, fallbackCard = null) {
  const multipliers = roundResourceMultipliers?.[country];
  if (
    multipliers &&
    ["agri", "oil", "mines"].every(field => Number.isInteger(multipliers[field]) && multipliers[field] >= 1 && multipliers[field] <= 3)
  ) {
    return multipliers;
  }
  return fallbackCard
    ? { agri: fallbackCard.agri, oil: fallbackCard.oil, mines: fallbackCard.mines }
    : { agri: 1, oil: 1, mines: 1 };
}

function isCountryIntelHiddenByBlackout(country) {
  return isGlobalConditionActive("blackout") &&
    (!assignedCountry || cleanStr(country) !== cleanStr(assignedCountry.name));
}

function applyRoundResourceMultipliers(multipliers) {
  roundResourceMultipliers = multipliers && typeof multipliers === "object" ? multipliers : {};
  if (assignedCountry) {
    countryMultipliers = { ...getCountryRoundMultipliers(assignedCountry.name, assignedCountry) };
  }
}

function applyRoomSnapshot(room) {
  if (!room || !Array.isArray(room.players)) return;
  applyEditionUi(room.edition || activeEdition);
  const serverRound = Number(room.roundNumber);
  const serverGameFinished = Boolean(room.gameFinished);
  const isExplicitGameReset = gameFinished && serverRound === 1 && !serverGameFinished;
  if (
    Number.isInteger(serverRound) &&
    serverRound < currentRound &&
    !isExplicitGameReset
  ) {
    return;
  }
  if (Number.isInteger(serverRound) && serverRound >= 1 && serverRound <= 3) {
    currentRound = serverRound;
  }
  gameFinished = Boolean(room.gameFinished);
  finalPlacements = Array.isArray(room.finalPlacements) ? room.finalPlacements : [];
  applyRoundResourceMultipliers(room.resourceMultipliers);
  updateCountryUI();
  activeRoomPlayers = room.players;
  pendingServerTrades = Array.isArray(room.pendingTrades) ? room.pendingTrades : [];
  const localPlayer = activeRoomPlayers.find(player =>
    cleanStr(player.country) === cleanStr(assignedCountry?.name || "")
  );
  if (localPlayer) {
    fieldTradeAttemptsUsed = Number(localPlayer.tradeAttemptsUsed) || 0;
    skirmishAttacksExecuted = Number(localPlayer.soloAttacksUsed) || 0;
    skirmishMaxAllowedAttacks = Number(localPlayer.soloMaxAttacks) || 1;
  }
  registeredPlayersCount = activeRoomPlayers.length || 1;
  lockedPlayersSet = new Set(
    activeRoomPlayers.filter(player => player.locked).map(player => cleanStr(player.country))
  );

  if (room.activeCondition?.id) {
    activateGlobalCondition(room.activeCondition);
    eventDrawnThisRound = true;
  } else {
    clearActiveGlobalCondition();
    eventDrawnThisRound = false;
  }

  if (Array.isArray(room.alliances)) {
    activePresidentCoalition = room.alliances.find(alliance => alliance.allianceType === "Mega-Merger") || null;
    activeCounterUnion = room.alliances.find(alliance => alliance.allianceType === "Counter-Union") || null;
  }

  readyPlayersSet = new Set(
    activeRoomPlayers.filter(player => player.ready).map(player => cleanStr(player.country))
  );
  updateReadyConsensusUI();
  updateAllianceUI();
  renderTvRoster();
  updateTvRoundStatus();
  renderFinalPlacements();
  syncFinishedGameControls();
  syncHostButtonsUI();
  renderCommandBoard();
}

async function refreshRoomSnapshot() {
  if (typeof fetch !== "function") return;
  try {
    const response = await fetch(editionApiPath("/api/room/state"), { credentials: "same-origin" });
    if (!response.ok) return;
    const data = await response.json();
    applyRoomSnapshot(data.room);
  } catch (e) {}
}

async function refreshPlayerEconomy() {
  if (typeof fetch !== "function") return;
  try {
    const response = await fetch(editionApiPath("/api/session"), { credentials: "same-origin" });
    if (!response.ok) return;
    const session = await response.json();
    if (!session?.economy) return;
    coins = Number(session.economy.coins) || 0;
    loans = Number(session.economy.loans) || 0;
    loanInterest = Number(session.economy.loanInterest) || 0;
    coinRequestsUsed = Math.max(0, Number(session.economy.coinRequestsUsed) || 0);
    if (session.economy.battleAllowance) {
      skirmishAttacksExecuted = Number(session.economy.battleAllowance.attacksUsed) || 0;
      skirmishMaxAllowedAttacks = Number(session.economy.battleAllowance.maxAttacks) || 1;
    }
    lastRoundSettlement = session.economy.lastSettlement?.fieldYields
      ? session.economy.lastSettlement
      : null;
    updateUI();
  } catch (error) {
    // The event still supplies the public balance result. A later session refresh
    // restores the private field-by-field receipt if this request is interrupted.
  }
}

function renderTvRoster() {
  const wrapper = document.getElementById("poker-seats-wrapper");
  if (!wrapper) return;
  wrapper.replaceChildren();
  activeRoomPlayers.forEach(player => {
    const country = activeCountryCard(player.country);
    const intelHidden = isCountryIntelHiddenByBlackout(player.country);
    const multipliers = intelHidden ? null : getCountryRoundMultipliers(player.country, country);
    const alliance = [activePresidentCoalition, activeCounterUnion].find(item =>
      Array.isArray(item?.members) && item.members.some(member => cleanStr(member) === cleanStr(player.country))
    );
    const seat = document.createElement("article");
    seat.className = `poker-seat ${player.locked ? "is-locked" : "is-planning"}${player.ready ? " is-ready" : ""}${alliance ? " is-allied" : ""}`;
    const stateLabel = document.createElement("span");
    stateLabel.className = "tv-seat-state";
    stateLabel.textContent = player.ready
      ? "READY"
      : alliance
        ? alliance.allianceType === "Mega-Merger" ? "MEGA-MERGER" : "COUNTER-UNION"
        : player.locked ? "LOCKED" : "PLANNING";
    const countryLabel = document.createElement("strong");
    countryLabel.className = "tv-seat-country";
    countryLabel.textContent = player.country;
    const handleLabel = document.createElement("span");
    handleLabel.className = "tv-seat-handle";
    handleLabel.textContent = `${player.handle}${player.isHost ? " · Host" : ""}`;
    const statusLabel = document.createElement("small");
    statusLabel.className = "tv-seat-status";
    statusLabel.textContent = player.locked ? "🔒 Investments locked" : "Planning investments";
    const resources = document.createElement("div");
    resources.className = "tv-seat-resources";
    if (intelHidden) {
      resources.textContent = (translations[currentLang] || translations.en).txtBlackoutHidden;
    } else {
      [
        ["🌾", "Agriculture", getEffectiveResourceMultiplier("agri", multipliers.agri)],
        ["🛢️", "Oil", getEffectiveResourceMultiplier("oil", multipliers.oil)],
        ["⛏️", "Mines", getEffectiveResourceMultiplier("mines", multipliers.mines)]
      ].forEach(([icon, label, value]) => {
        const item = document.createElement("span");
        item.title = label;
        item.textContent = `${icon} ×${value}`;
        resources.appendChild(item);
      });
    }
    const investmentLabel = document.createElement("strong");
    investmentLabel.className = "tv-seat-investment";
    investmentLabel.textContent = intelHidden
      ? (translations[currentLang] || translations.en).txtBlackoutHidden
      : player.totalInvestment == null
      ? "💰 Total investment: Not locked"
      : `💰 Total investment: ${player.totalInvestment} coins`;
    seat.append(stateLabel, countryLabel, handleLabel, resources, investmentLabel, statusLabel);
    if (country) seat.dataset.country = country.name;
    wrapper.appendChild(seat);
  });
}

function updateTvRoundStatus() {
  const status = document.getElementById("tv-round-status");
  if (!status) return;
  if (gameFinished) {
    status.textContent = "GAME COMPLETE · FINAL PLACEMENTS READY";
    return;
  }
  if (activeRoomPlayers.length === 0 && !assignedCountry) {
    status.textContent = "AWAITING COMMANDERS";
    return;
  }
  const readyCount = readyPlayersSet.size;
  const total = registeredPlayersCount || activeRoomPlayers.length || 1;
  status.textContent = `ROUND ${currentRound} / 3 · ${readyCount} OF ${total} COMMANDERS READY`;
}

function renderFinalPlacements() {
  const panel = document.getElementById("final-placements-panel");
  const list = document.getElementById("final-placements-list");
  if (!panel || !list) return;

  panel.classList.toggle("hidden", !gameFinished);
  panel.setAttribute("aria-hidden", String(!gameFinished));
  if (!gameFinished) return;

  list.replaceChildren();
  finalPlacements.forEach(entry => {
    const item = document.createElement("li");
    const placement = document.createElement("strong");
    placement.textContent = `#${entry.placement}`;
    const country = document.createElement("span");
    country.textContent = entry.country;
    const balance = document.createElement("span");
    balance.textContent = `${entry.coins} Coins`;
    item.append(placement, country, balance);
    list.appendChild(item);
  });
}

function syncFinishedGameControls() {
  if (!gameFinished) return;
  [
    "btn-buy-coins",
    "btn-counter-union",
    "btn-alliance-skirmish",
    "btn-lock-invest",
    "btn-player-ready"
  ].forEach(id => {
    const control = document.getElementById(id);
    if (control) control.disabled = true;
  });
}

const TV_SEAT_HIGHLIGHT_CLASSES = [
  "is-locked-highlight",
  "is-ready-highlight",
  "is-trade-highlight",
  "is-combat-highlight",
  "is-alliance-highlight"
];
const TV_CENTER_HIGHLIGHT_CLASSES = [
  "is-broadcast-highlight",
  "is-global-highlight",
  "is-ready-center-highlight",
  "is-trade-center-highlight",
  "is-combat-center-highlight",
  "is-alliance-center-highlight"
];
const TV_TABLE_MOTION_CLASSES = [
  "is-motion-broadcast",
  "is-motion-global",
  "is-motion-ready",
  "is-motion-trade",
  "is-motion-combat",
  "is-motion-alliance"
];

function clearVisualClasses(element, classNames) {
  if (!element) return;
  element.classList.remove(...classNames);
}

function tvMotionClassForCenterClass(className) {
  if (className.includes("global")) return "is-motion-global";
  if (className.includes("trade")) return "is-motion-trade";
  if (className.includes("combat")) return "is-motion-combat";
  if (className.includes("alliance")) return "is-motion-alliance";
  if (className.includes("ready")) return "is-motion-ready";
  return "is-motion-broadcast";
}

function pulseTvTableMotion(className, duration = 680) {
  const felt = document.querySelector(".tv-felt");
  clearVisualClasses(felt, TV_TABLE_MOTION_CLASSES);
  pulseVisual(felt, className, duration);
}

function pulseTvCenter(className = "is-broadcast-highlight", duration = 680) {
  const center = document.querySelector(".table-center-pot");
  clearVisualClasses(center, TV_CENTER_HIGHLIGHT_CLASSES);
  pulseVisual(center, className, duration);
  pulseTvTableMotion(tvMotionClassForCenterClass(className), duration);
}

function playTvTableLink(sourceCountry, targetCountry, kind = "trade") {
  if (!sourceCountry || !targetCountry || cleanStr(sourceCountry) === cleanStr(targetCountry)) return;
  const felt = document.querySelector(".tv-felt");
  const source = Array.from(document.querySelectorAll(".poker-seat")).find(item =>
    cleanStr(item.dataset.country) === cleanStr(sourceCountry)
  );
  const target = Array.from(document.querySelectorAll(".poker-seat")).find(item =>
    cleanStr(item.dataset.country) === cleanStr(targetCountry)
  );
  if (!felt || !source || !target) return;

  const feltRect = felt.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2 - feltRect.left;
  const startY = sourceRect.top + sourceRect.height / 2 - feltRect.top;
  const endX = targetRect.left + targetRect.width / 2 - feltRect.left;
  const endY = targetRect.top + targetRect.height / 2 - feltRect.top;
  const length = Math.hypot(endX - startX, endY - startY);
  if (!Number.isFinite(length) || length < 8) return;

  const link = document.createElement("span");
  link.className = `table-flight table-flight-${kind}`;
  link.style.left = `${startX}px`;
  link.style.top = `${startY}px`;
  link.style.setProperty("--flight-length", `${length}px`);
  link.style.setProperty("--flight-angle", `${Math.atan2(endY - startY, endX - startX)}rad`);
  felt.appendChild(link);
  window.requestAnimationFrame(() => link.classList.add("is-active"));
  window.setTimeout(() => link.remove(), 920);
}

function showTvAtomicCloud(country) {
  const seat = Array.from(document.querySelectorAll(".poker-seat")).find(item =>
    cleanStr(item.dataset.country) === cleanStr(country)
  );
  if (!seat) return;

  seat.querySelector(".tv-mushroom-cloud")?.remove();
  seat.classList.add("has-atomic-cloud");
  const cloud = document.createElement("span");
  cloud.className = "tv-mushroom-cloud";
  cloud.setAttribute("aria-hidden", "true");
  const cap = document.createElement("span");
  cap.className = "tv-mushroom-cap";
  const stem = document.createElement("span");
  stem.className = "tv-mushroom-stem";
  cloud.append(cap, stem);
  seat.appendChild(cloud);
  window.setTimeout(() => {
    cloud.remove();
    if (!seat.querySelector(".tv-mushroom-cloud")) {
      seat.classList.remove("has-atomic-cloud");
    }
  }, 3600);
}

function pulseTvSeat(country, className = "is-broadcast-highlight") {
  const seat = Array.from(document.querySelectorAll(".poker-seat")).find(item =>
    cleanStr(item.dataset.country) === cleanStr(country)
  );
  clearVisualClasses(seat, TV_SEAT_HIGHLIGHT_CLASSES);
  pulseVisual(seat, className, 680);
  const centerClass = className.includes("combat")
    ? "is-combat-center-highlight"
    : className.includes("trade")
      ? "is-trade-center-highlight"
      : className.includes("alliance")
        ? "is-alliance-center-highlight"
        : className.includes("locked") || className.includes("ready")
          ? "is-ready-center-highlight"
          : "is-broadcast-highlight";
  pulseTvCenter(centerClass, 680);
}

const roomSeatsState = [
  { id: 1, country: "USA 🇺🇸", countryAssigned: true, taken: false, player: null, agri: 3, oil: 2, mines: 1, locked: false },
  { id: 2, country: "Saudi Arabia 🇸🇦", countryAssigned: true, taken: false, player: null, agri: 1, oil: 3, mines: 2, locked: false },
  { id: 3, country: "Australia 🇦🇺", countryAssigned: true, taken: false, player: null, agri: 2, oil: 1, mines: 3, locked: false },
  { id: 4, country: "Brazil 🇧🇷", countryAssigned: true, taken: false, player: null, agri: 3, oil: 1, mines: 2, locked: false },
  { id: 5, country: "Norway 🇳🇴", countryAssigned: true, taken: false, player: null, agri: 1, oil: 2, mines: 3, locked: false },
  { id: 6, country: "Canada 🇨🇦", countryAssigned: true, taken: false, player: null, agri: 2, oil: 3, mines: 1, locked: false },
  { id: 7, country: "China 🇨🇳", countryAssigned: true, taken: false, player: null, agri: 3, oil: 1, mines: 3, locked: false },
  { id: 8, country: "Japan 🇯🇵", countryAssigned: true, taken: false, player: null, agri: 1, oil: 2, mines: 2, locked: false },
  { id: 9, country: "Germany 🇩🇪", countryAssigned: true, taken: false, player: null, agri: 2, oil: 2, mines: 3, locked: false },
  { id: 10, country: "South Africa 🇿🇦", countryAssigned: true, taken: false, player: null, agri: 2, oil: 1, mines: 3, locked: false }
];

const countryCards = [
  { name: "USA 🇺🇸", agri: 3, oil: 2, mines: 1 },
  { name: "Saudi Arabia 🇸🇦", agri: 1, oil: 3, mines: 2 },
  { name: "Australia 🇦🇺", agri: 2, oil: 1, mines: 3 },
  { name: "Brazil 🇧🇷", agri: 3, oil: 1, mines: 2 },
  { name: "Norway 🇳🇴", agri: 1, oil: 2, mines: 3 },
  { name: "Canada 🇨🇦", agri: 2, oil: 3, mines: 1 },
  { name: "China 🇨🇳", agri: 3, oil: 1, mines: 3 },
  { name: "Japan 🇯🇵", agri: 1, oil: 2, mines: 2 },
  { name: "Germany 🇩🇪", agri: 2, oil: 2, mines: 3 },
  { name: "South Africa 🇿🇦", agri: 2, oil: 1, mines: 3 }
];

const cardDeck = [
  { title: "Banker", icon: "🏦", desc: "Automatically loans 20% of your available unallocated cash." },
  { title: "President", icon: "🏛️", desc: "Initiate strategic alliance mergers." },
  { title: "General", icon: "🎖️", desc: "Grants 2 skirmish attacks per round." },
  { title: "Spy", icon: "🕵️", desc: "Interrupt rival deal agreements." },
  { title: "Merchant", icon: "💰", desc: "Generates +10% extra profit on all field buy/sell transactions." },
  { title: "Atomic Bomb", icon: "☢️", desc: "Destroy 20% of 1 target field's investment. Disabled during Pandemic in Advanced Edition." },
  { title: "Hitman", icon: "🕶️", desc: "Randomly target one opposing country and disable its General or Spy card." }
];

const proficiencyCardCopy = {
  en: {
    Hitman: "Randomly target one opposing country and disable its General or Spy card."
  },
  tr: {
    Hitman: "Rastgele bir rakip ülkeyi hedef alın ve General veya Spy kartını devre dışı bırakın."
  },
  fa: {
    Hitman: "یک کشور رقیب را به‌صورت تصادفی هدف بگیرید و کارت ژنرال یا جاسوس آن را غیرفعال کنید."
  }
};

function localizedCardDescription(card) {
  return proficiencyCardCopy[currentLang]?.[card.title] || card.desc;
}

function setTxt(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function pulseVisual(element, className = "is-event-updated", duration = 420) {
  if (!element) return;
  const existing = visualPulseTimers.get(element);
  if (existing) window.clearTimeout(existing);
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  visualPulseTimers.set(element, window.setTimeout(() => {
    element.classList.remove(className);
    visualPulseTimers.delete(element);
  }, duration));
}

const soundManager = {
  enabled: false,
  context: null,
  lastPlayed: new Map(),
  activeLoops: new Map(),
  gestureUnlockBound: false,

  init() {
    try {
      this.enabled = localStorage.getItem(soundPreferenceKey) === "on";
    } catch (e) {
      this.enabled = false;
    }
    this.bindGestureUnlock();
    this.updateControls();
  },

  bindGestureUnlock() {
    if (this.gestureUnlockBound || typeof document === "undefined") return;
    this.gestureUnlockBound = true;
    const unlockFromGesture = () => {
      if (this.enabled && (!this.context || this.context.state !== "running")) {
        void this.unlock();
      }
    };
    ["pointerdown", "keydown", "touchstart"].forEach(eventName => {
      document.addEventListener(eventName, unlockFromGesture, {
        capture: true,
        passive: eventName !== "keydown"
      });
    });
  },

  updateControls() {
    document.querySelectorAll("[data-sound-toggle]").forEach(button => {
      button.textContent = this.enabled ? "Sound: On" : "Sound: Off";
      button.setAttribute("aria-pressed", String(this.enabled));
      button.title = this.enabled
        ? "Game sound effects are on. Your next interaction enables audio if the browser requires it."
        : "Turn on game sound effects.";
    });
  },

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    try {
      localStorage.setItem(soundPreferenceKey, this.enabled ? "on" : "off");
    } catch (e) {}
    this.updateControls();
    if (this.enabled) {
      await this.unlock();
      this.play("ui", { force: true });
    } else {
      this.stopAllLoops();
    }
  },

  async unlock() {
    if (!this.enabled || typeof window === "undefined") return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!this.context) this.context = new AudioContextClass();
    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch (e) {
        return false;
      }
    }
    return this.context.state === "running";
  },

  tone(frequency, start, duration, volume = 0.035, type = "sine") {
    if (!this.context || this.context.state !== "running") return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  },

  startLoop(category, options = {}) {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    this.stopLoop(category);
    const duration = options.duration ?? 2200;
    const interval = options.interval ?? 680;
    const startedAt = Date.now();
    const tick = () => {
      if (
        !this.enabled ||
        Date.now() - startedAt >= duration ||
        !this.context ||
        this.context.state !== "running"
      ) {
        this.stopLoop(category);
        return;
      }
      this.play(category, { force: true });
    };
    tick();
    this.activeLoops.set(category, window.setInterval(tick, interval));
  },

  stopLoop(category) {
    const timer = this.activeLoops.get(category);
    if (timer) window.clearInterval(timer);
    this.activeLoops.delete(category);
  },

  stopAllLoops() {
    this.activeLoops.forEach(timer => window.clearInterval(timer));
    this.activeLoops.clear();
  },

  play(category, options = {}) {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    const nowMs = Date.now();
    const cooldown = options.cooldown ?? 170;
    if (!options.force && nowMs - (this.lastPlayed.get(category) || 0) < cooldown) return;
    this.lastPlayed.set(category, nowMs);

    const now = this.context.currentTime + 0.01;
    const cues = {
      ui: [[520, 0, 0.05, 0.018]],
      tick: [[210, 0, 0.035, 0.012]],
      lock: [[440, 0, 0.09, 0.03], [660, 0.1, 0.12, 0.034]],
      ready: [[523, 0, 0.08, 0.028], [784, 0.09, 0.13, 0.032]],
      playerJoin: [[523, 0, 0.06, 0.019], [659, 0.08, 0.09, 0.023]],
      playerLeave: [[330, 0, 0.08, 0.018, "triangle"], [247, 0.09, 0.1, 0.018, "triangle"]],
      cards: [[740, 0, 0.025, 0.012, "square"], [622, 0.06, 0.03, 0.012, "square"], [740, 0.12, 0.035, 0.014, "square"]],
      tradeProposal: [[392, 0, 0.06, 0.022], [587, 0.08, 0.08, 0.026]],
      tradeLoop: [[523, 0, 0.11, 0.038], [659, 0.13, 0.11, 0.044], [784, 0.27, 0.15, 0.04], [659, 0.46, 0.11, 0.034]],
      tradeAccepted: [[523, 0, 0.07, 0.026], [659, 0.08, 0.08, 0.029], [784, 0.17, 0.11, 0.03]],
      tradeRejected: [[392, 0, 0.08, 0.022, "triangle"], [294, 0.1, 0.12, 0.024, "triangle"]],
      allianceProposal: [[330, 0, 0.08, 0.022], [440, 0.09, 0.09, 0.025]],
      allianceLoop: [[330, 0, 0.12, 0.034], [494, 0.14, 0.12, 0.039], [659, 0.29, 0.16, 0.04]],
      allianceConfirmed: [[330, 0, 0.08, 0.026], [494, 0.09, 0.1, 0.03], [659, 0.2, 0.13, 0.032]],
      event: [[262, 0, 0.08, 0.024], [392, 0.1, 0.09, 0.028], [523, 0.2, 0.12, 0.03]],
      global: [[196, 0, 0.12, 0.024, "triangle"], [294, 0.13, 0.11, 0.026], [392, 0.25, 0.14, 0.029]],
      battle: [[130, 0, 0.11, 0.04, "triangle"], [98, 0.1, 0.13, 0.028, "sawtooth"]],
      battleLoop: [[196, 0, 0.1, 0.043, "triangle"], [247, 0.13, 0.1, 0.04, "triangle"], [147, 0.27, 0.14, 0.04, "sawtooth"]],
      stalemate: [[349, 0, 0.075, 0.023], [349, 0.12, 0.075, 0.023]],
      victory: [[523, 0, 0.08, 0.03], [659, 0.09, 0.09, 0.033], [784, 0.19, 0.14, 0.035]],
      defeat: [[260, 0, 0.1, 0.027, "triangle"], [196, 0.11, 0.14, 0.03, "triangle"]],
      atomic: [[164, 0, 0.08, 0.03, "square"], [164, 0.13, 0.08, 0.03, "square"], [74, 0.25, 0.22, 0.045, "sawtooth"]],
      atomicLoop: [[220, 0, 0.1, 0.043, "square"], [220, 0.16, 0.1, 0.04, "square"], [110, 0.32, 0.16, 0.045, "sawtooth"]],
      warning: [[196, 0, 0.08, 0.025, "triangle"], [196, 0.12, 0.08, 0.025, "triangle"]],
      round: [[392, 0, 0.08, 0.026], [523, 0.1, 0.1, 0.03], [659, 0.21, 0.16, 0.032]],
      allReady: [[523, 0, 0.07, 0.026], [659, 0.08, 0.08, 0.03], [784, 0.16, 0.1, 0.032], [1047, 0.27, 0.14, 0.03]]
    };
    (cues[category] || cues.ui).forEach(([frequency, offset, duration, volume, type]) => {
      this.tone(frequency, now + offset, duration, volume, type);
    });
  }
};

window.toggleGameSound = function() {
  void soundManager.setEnabled(!soundManager.enabled);
};

function playSound(category, options) {
  soundManager.play(category, options);
}

function startSoundLoop(category, options) {
  if (document.body?.classList.contains("tv-body")) {
    soundManager.startLoop(category, options);
  } else {
    soundManager.play(category, { force: true });
  }
}

function stopSoundLoop(category) {
  soundManager.stopLoop(category);
}

function createGameResultId() {
  gameResultAlertSequence += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `result-${crypto.randomUUID()}`;
  }
  return `result-${currentRound}-${Date.now()}-${gameResultAlertSequence}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortGameResultAlertQueue() {
  gameResultAlertQueue.sort((left, right) => {
    const leftSequence = Number.isFinite(left.sequence) ? left.sequence : Number.MAX_SAFE_INTEGER;
    const rightSequence = Number.isFinite(right.sequence) ? right.sequence : Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;

    const leftTimestamp = left.publishedAt || 0;
    const rightTimestamp = right.publishedAt || 0;
    if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;

    return String(left.id).localeCompare(String(right.id));
  });
}

function showNextGameResultAlert() {
  if (activeGameResultAlert || gameResultAlertQueue.length === 0) return;

  const overlay = document.getElementById("game-result-modal");
  if (!overlay) return;

  activeGameResultAlert = gameResultAlertQueue.shift();
  const result = activeGameResultAlert;
  const dismissButton = document.getElementById("btn-dismiss-game-result");
  if (document.activeElement && document.activeElement !== dismissButton) {
    previouslyFocusedGameResultElement = document.activeElement;
  }
  overlay.className = `modal-overlay result-alert-overlay result-alert-${result.tone || "neutral"} result-alert-enter`;

  setTxt("game-result-icon", result.icon || "📣");
  const displayResult = localizeGameResult(result);
  setTxt("game-result-eyebrow", displayResult.category || (currentLang === "tr" ? "OYUN SONUCU" : currentLang === "fa" ? "نتیجه بازی" : "GAME RESULT"));
  setTxt("game-result-title", displayResult.title || (currentLang === "tr" ? "Raund Güncellemesi" : currentLang === "fa" ? "به‌روزرسانی دور" : "Round Update"));
  setTxt("game-result-summary", displayResult.summary || "");
  setTxt("game-result-details", displayResult.details || "");
  setTxt(
    "game-result-queue-status",
    gameResultAlertQueue.length > 0
      ? notificationCopy().moreResults(gameResultAlertQueue.length)
      : ""
  );

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.remove("hidden");
  if (dismissButton && typeof dismissButton.focus === "function") {
    dismissButton.focus();
  }
}

function queueGameResultAlert(result) {
  if (!result) return;

  const normalized = {
    ...result,
    id: result.id || createGameResultId(),
    tone: result.tone || "neutral"
  };

  if (seenGameResultAlertIds.has(normalized.id)) return;
  seenGameResultAlertIds.add(normalized.id);
  const category = cleanStr(normalized.category);
  const cue = category.includes("skirmish")
    ? (normalized.tone === "success" ? "victory" : normalized.tone === "danger" ? "defeat" : "stalemate")
    : category.includes("atomic")
      ? "atomic"
      : category.includes("trade")
        ? (normalized.tone === "success" ? "tradeAccepted" : normalized.tone === "danger" ? "tradeRejected" : "tradeProposal")
      : category.includes("alliance")
        ? "allianceConfirmed"
        : category.includes("global")
          ? "global"
        : category.includes("round")
          ? "round"
          : normalized.tone === "success"
            ? "victory"
            : normalized.tone === "danger"
              ? "defeat"
              : "event";
  playSound(cue);

  if (seenGameResultAlertIds.size > 100) {
    const oldestId = seenGameResultAlertIds.values().next().value;
    seenGameResultAlertIds.delete(oldestId);
  }

  gameResultAlertQueue.push(normalized);
  sortGameResultAlertQueue();
  showNextGameResultAlert();
}

window.dismissGameResult = function() {
  const overlay = document.getElementById("game-result-modal");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  activeGameResultAlert = null;
  sortGameResultAlertQueue();
  showNextGameResultAlert();

  if (!activeGameResultAlert && previouslyFocusedGameResultElement && typeof previouslyFocusedGameResultElement.focus === "function") {
    previouslyFocusedGameResultElement.focus();
    previouslyFocusedGameResultElement = null;
  }
};

window.trapGameResultFocus = function(event) {
  if (!activeGameResultAlert) return;

  if (event.key === "Escape") {
    event.preventDefault();
    dismissGameResult();
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    document.getElementById("btn-dismiss-game-result")?.focus();
  }
};

window.publishGameResult = function(result) {
  const payload = {
    ...result,
    id: result?.id || createGameResultId(),
    round: Number.isInteger(Number(result?.round)) ? Number(result.round) : currentRound,
    publishedAt: result?.publishedAt || Date.now()
  };

  queueGameResultAlert(payload);
  if (gameBroadcast) {
    gameBroadcast.postMessage({ type: "GAME_RESULT", payload });
  }
};

window.logAction = function(msg, tag = "INFO") {
  setTxt("action-log", localizeNotificationMessage(msg));

  const entry = {
    round: currentRound,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    country: assignedCountry ? assignedCountry.name : "Commander",
    tag: tag,
    message: msg
  };

  gameActivityLedger.unshift(entry);

  try {
    localStorage.setItem("world_war_round_announcements", JSON.stringify(gameActivityLedger));
  } catch (e) {}

  if (gameBroadcast) {
    gameBroadcast.postMessage({ type: "LOG_ENTRY", payload: entry });
  }

  renderRoundAnnouncements();
};

function renderRoundAnnouncements() {
  const container = document.getElementById("round-announcements");
  if (!container) return;

  container.replaceChildren();

  if (gameActivityLedger.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "announcement-empty";
    emptyDiv.textContent = notificationCopy().empty;
    container.appendChild(emptyDiv);
    return;
  }

  gameActivityLedger.forEach(item => {
    const row = document.createElement("div");
    const tagClass = cleanStr(item.tag).replace(/[^a-z0-9]+/g, "-") || "info";
    row.className = `announcement-entry announcement-${tagClass}${item === gameActivityLedger[0] ? " is-new" : ""}`;

    const copy = document.createElement("div");
    copy.className = "announcement-copy";

    const meta = document.createElement("span");
    meta.className = "announcement-meta";
    meta.textContent = `R${item.round} · ${item.time} · ${item.country}`;

    const message = document.createElement("span");
    message.textContent = localizeNotificationMessage(item.message);

    const tag = document.createElement("span");
    tag.className = "announcement-tag";
    tag.textContent = localizeNotificationTag(item.tag);

    copy.append(meta, message);
    row.append(copy, tag);
    container.appendChild(row);
  });
}

function resetRoundAnnouncements() {
  gameActivityLedger = [];
  try { localStorage.removeItem("world_war_round_announcements"); } catch (e) {}
  renderRoundAnnouncements();
}

function resetLocalSoloBattleAllowance() {
  skirmishAttacksExecuted = 0;
  skirmishMaxAllowedAttacks = 1;
}

function safeStorageGet(key, fallback = null) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (e) {
    return fallback;
  }
}

function clearPlayerGameMemory() {
  try {
    const gameKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("world_war_")) gameKeys.push(key);
    }
    gameKeys.forEach(key => localStorage.removeItem(key));
    localStorage.removeItem("selected_lang");
  } catch (e) {}

  try {
    sessionStorage.clear();
  } catch (e) {}
}

window.exitGame = async function() {
  const exitButton = document.getElementById("btn-exit-game");
  const hostMessage = isRoomCreator
    ? registeredPlayersCount > 1
      ? " The next seated player will become the host."
      : " The room will reset because you are its last player."
    : "";

  if (!window.confirm(`Exit this game? Your seat, reconnect access, and saved game data on this device will be cleared.${hostMessage}`)) {
    return;
  }

  if (exitButton) exitButton.disabled = true;
  try {
    const response = await fetch(editionApiPath("/api/room/leave"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ edition: activeEdition })
    });
    const data = await response.json();
    if (!response.ok) {
      window.alert(data.error || "Could not exit the game. Please try again.");
      return;
    }

    clearPlayerGameMemory();
    gameBroadcast?.close();
    window.location.replace(`index.html?${editionQuery()}`);
  } catch (e) {
    window.alert("Could not reach the game server. Please try again.");
  } finally {
    if (exitButton) exitButton.disabled = false;
  }
};

function cleanStr(str) {
  return (str || "").toString().trim().toLowerCase();
}

function handleAllianceRoomEvent(event) {
  if (event.type === "PROPOSE_ALLIANCE") {
    pendingAllianceProposal = event.payload;
    updateAllianceUI();
    pulseTvSeat(event.payload?.initiator, "is-alliance-highlight");
    (event.payload?.pendingTargets || []).forEach(target => {
      pulseTvSeat(target, "is-alliance-highlight");
      playTvTableLink(event.payload?.initiator, target, "alliance");
    });
    startSoundLoop("allianceLoop", { duration: 2200, interval: 620 });
  } else if (event.type === "APPROVE_ALLIANCE") {
    if (
      pendingAllianceProposal &&
      event.payload?.proposalId === pendingAllianceProposal.proposalId
    ) {
      recordAllianceApproval(pendingAllianceProposal, event.payload.approvedBy);
      const localCountry = assignedCountry ? assignedCountry.name : "";
      if (
        pendingAllianceProposal.pendingTargets.length === 0 &&
        cleanStr(localCountry) === cleanStr(pendingAllianceProposal.initiator)
      ) {
        void finalizeAllianceProposal(pendingAllianceProposal);
      } else {
        updateAllianceUI();
      }
    }
    pulseTvSeat(event.payload?.approvedBy, "is-alliance-highlight");
    startSoundLoop("allianceLoop", { duration: 1500, interval: 620 });
  } else if (event.type === "CONFIRM_ALLIANCE") {
    if (event.payload.allianceType === "Mega-Merger") {
      activePresidentCoalition = event.payload.data;
    } else {
      activeCounterUnion = event.payload.data;
    }
    pendingAllianceProposal = null;
    updateAllianceUI();
    (event.payload?.data?.members || []).forEach(country => {
      pulseTvSeat(country, "is-alliance-highlight");
    });
    const members = event.payload?.data?.members || [];
    members.slice(1).forEach(country => playTvTableLink(members[0], country, "alliance"));
    stopSoundLoop("allianceLoop");
    playSound("allianceConfirmed");
  } else if (event.type === "ALLIANCE_SKIRMISH") {
    applyAllianceSkirmishResult(event.payload);
  } else if (event.type === "REJECT_ALLIANCE") {
    pendingAllianceProposal = null;
    updateAllianceUI();
    logAction(`❌ Alliance Proposal Rejected by ${event.payload.rejectedBy}! Alliance cancelled.`, "ALLIANCE");
  }
}

function allianceForProposalId(proposalId) {
  if (activePresidentCoalition?.proposalId === proposalId) return activePresidentCoalition;
  if (activeCounterUnion?.proposalId === proposalId) return activeCounterUnion;
  return null;
}

function syncAlliancePool(alliance, snapshot) {
  if (!alliance || !snapshot) return;
  alliance.pool = { ...snapshot.pool };
  alliance.attacksUsed = snapshot.attacksUsed ?? alliance.attacksUsed ?? 0;
}

function applyAllianceSkirmishResult(result) {
  if (!result?.attacker || !result?.defender) return;
  startSoundLoop("battleLoop", { duration: 1500, interval: 520 });
  syncAlliancePool(allianceForProposalId(result.attacker.proposalId), result.attacker);
  if (result.defender.kind === "alliance") {
    syncAlliancePool(allianceForProposalId(result.defender.id), result.defender);
  } else if (
    assignedCountry &&
    cleanStr(assignedCountry.name) === cleanStr(result.defender.country) &&
    result.defender.pool
  ) {
    investments[result.field] = result.defender.pool[result.field] || 0;
    const slider = document.getElementById(`slider-${result.field}`);
    if (slider) slider.value = investments[result.field];
    updateUI();
  }

  const fieldLabel = result.field === "agri" ? "Agriculture" : result.field === "oil" ? "Oil" : "Mines";
  const title = result.outcome === "victory"
    ? "Alliance Skirmish Victory"
    : result.outcome === "defeat"
      ? "Alliance Skirmish Defeat"
      : "Alliance Skirmish Stalemate";
  const winnerLabel = result.winner || "Neither alliance";
  queueGameResultAlert({
    id: `alliance-skirmish-${result.attacker.proposalId}-${result.attacker.attacksUsed}`,
    icon: result.outcome === "stalemate" ? "⚔️" : "🏳️",
    category: "ALLIANCE SKIRMISH",
    tone: result.outcome === "stalemate" ? "neutral" : "success",
    title,
    summary: result.outcome === "stalemate"
      ? `${result.attacker.initiator} and ${result.defender.country} tied over ${fieldLabel}.`
      : `${winnerLabel} won the ${fieldLabel} coalition battle.`,
    details: `Attack power: ${result.attackerPower} · Defense power: ${result.defenderPower} · ${result.transfer} Coins transferred.`
  });
  logAction(
    `⚔️ Alliance skirmish: ${result.attacker.initiator} vs ${result.defender.country} on ${fieldLabel}. ${result.outcome.toUpperCase()}${result.transfer ? ` — ${result.transfer} Coins transferred.` : "."}`,
    "ALLIANCE"
  );
  pulseTvSeat(result.attacker.initiator, "is-combat-highlight");
  pulseTvSeat(result.defender.country, "is-combat-highlight");
  playTvTableLink(result.attacker.initiator, result.defender.country, "combat");
  updateAllianceUI();
}

function applyGeneralAllowance(result) {
  if (
    !result ||
    !assignedCountry ||
    cleanStr(result.country) !== cleanStr(assignedCountry.name)
  ) return;
  skirmishAttacksExecuted = result.attacksUsed || 0;
  skirmishMaxAllowedAttacks = result.maxAttacks || 1;
}

function applySoloSkirmishResult(result, eventId) {
  if (!result?.attacker || !result?.defender) return;
  startSoundLoop("battleLoop", { duration: 1500, interval: 520 });
  const localCountry = assignedCountry ? cleanStr(assignedCountry.name) : "";
  const applyResources = participant => {
    if (localCountry !== cleanStr(participant.country) || !participant.resources) return;
    investments = { ...participant.resources };
    updateUI();
  };
  applyResources(result.attacker);
  applyResources(result.defender);
  if (localCountry === cleanStr(result.attacker.country)) {
    skirmishAttacksExecuted = result.attacker.attacksUsed || 0;
    skirmishMaxAllowedAttacks = result.attacker.maxAttacks || 1;
  }

  const fieldLabel = result.field === "agri" ? "Agriculture" : result.field === "oil" ? "Oil" : "Mines";
  const title = result.outcome === "victory"
    ? "Skirmish Victory"
    : result.outcome === "defeat"
      ? "Skirmish Defeat"
      : "Skirmish Stalemate";
  queueGameResultAlert({
    id: Number.isFinite(eventId)
      ? `solo-skirmish-${eventId}`
      : `solo-skirmish-${result.attacker.country}-${result.attacker.attacksUsed}`,
    icon: "⚔️",
    category: "SKIRMISH RESULT",
    tone: result.outcome === "stalemate" ? "neutral" : result.outcome === "defeat" ? "danger" : "success",
    title,
    summary: result.outcome === "stalemate"
      ? `${result.attacker.country} and ${result.defender.country} tied over ${fieldLabel}.`
      : `${result.winner} won the ${fieldLabel} skirmish.`,
    details: `Attack power: ${result.attackerPower} · Defense power: ${result.defenderPower} · ${result.transfer} field resources transferred.`
  });
  logAction(
    `⚔️ Skirmish: ${result.attacker.country} vs ${result.defender.country} on ${fieldLabel}. ${result.outcome.toUpperCase()}${result.transfer ? ` — ${result.transfer} resources transferred.` : "."}`,
    "SKIRMISH"
  );
  pulseTvSeat(result.attacker.country, "is-combat-highlight");
  pulseTvSeat(result.defender.country, "is-combat-highlight");
  playTvTableLink(result.attacker.country, result.defender.country, "combat");
}

function publishRoundLifecycleAlerts(event) {
  const payload = event?.payload || {};
  const completedRound = Number(payload.round);
  if (!Number.isInteger(completedRound)) return;

  const localResult = assignedCountry ? payload.results?.[assignedCountry.name] : null;
  const grossProfit = Number(localResult?.grossProfit);
  const repayment = Number(localResult?.repayment);
  const settlementDetails = Number.isFinite(grossProfit)
    ? `Your settlement: +${grossProfit} Coins from fields${repayment > 0 ? `, with ${repayment} Coins collected for loan repayment` : ""}.`
    : "The server has settled every commander’s field income and Banker obligations.";

  publishGameResult({
    id: Number.isFinite(event.id) ? `round-complete-${event.id}` : `round-complete-${completedRound}`,
    round: completedRound,
    icon: payload.gameFinished ? "🏆" : "✅",
    category: payload.gameFinished ? "FINAL ROUND COMPLETE" : "ROUND COMPLETE",
    tone: "success",
    title: `Round ${completedRound} Complete`,
    summary: `Round ${completedRound} has been settled for every commander.`,
    details: settlementDetails
  });

  const nextRound = Number(payload.nextRound);
  if (!payload.gameFinished && Number.isInteger(nextRound)) {
    publishGameResult({
      id: Number.isFinite(event.id) ? `round-start-${event.id}` : `round-start-${nextRound}`,
      round: nextRound,
      icon: "🎲",
      category: "NEW ROUND",
      tone: "neutral",
      title: `Round ${nextRound} Started`,
      summary: `Round ${nextRound} is now open.`,
      details: "New resource multipliers are active. Proficiency Cards are dealt automatically; lock your investments when ready."
    });
  }
}

function applyHostEvent(event) {
  if (!event?.type) return;
  if (Number.isFinite(event.id)) {
    if (event.id <= lastHostEventId) return;
    lastHostEventId = event.id;
  }

  if (event.type === "PLAYER_JOINED" || event.type === "PLAYER_LEFT") {
    void refreshRoomSnapshot();
    pulseTvCenter("is-broadcast-highlight", 500);
    playSound(event.type === "PLAYER_JOINED" ? "playerJoin" : "playerLeave");
  } else if (event.type === "HOST_DEAL_CARDS") {
    if (cardsDealtThisRound) return;
    cardsDealtThisRound = true;
    void refreshCurrentHand();
    syncHostButtonsUI();
    logAction(`👑 Host dealt and locked 2 proficiency cards for Round ${currentRound}!`, "HOST");
    pulseTvCenter("is-broadcast-highlight", 500);
    playSound("cards");
  } else if (event.type === "HOST_DRAW_EVENT") {
    if (eventDrawnThisRound) return;
    eventDrawnThisRound = true;
    activateGlobalCondition(event.payload);
    syncHostButtonsUI();
    const eventTitle = activeGlobalCondition?.title || event.payload?.id || "Unknown Event";
    logAction(`🎲 Host drawn Global Event Card: ${eventTitle}!`, "EVENT");
    publishGameResult({
      id: Number.isFinite(event.id) ? `global-condition-${event.id}` : `global-condition-${event.payload?.id}`,
      icon: "🌍",
      category: "GLOBAL CONDITION",
      tone: "neutral",
      title: eventTitle,
      summary: activeGlobalCondition?.desc || "A new Global Condition applies to this round.",
      details: "This condition was drawn automatically after every seated commander locked investments."
    });
    pulseVisual(document.getElementById("global-event-banner"), "is-event-updated", 620);
    pulseTvCenter("is-global-highlight", 620);
  } else if (event.type === "EXECUTE_ROUND_CALCULATION") {
    const result = assignedCountry ? event.payload?.results?.[assignedCountry.name] : null;
    calculateAndAdvanceRound(result || null, event.payload || {});
    void refreshPlayerEconomy();
    if (event.payload?.cardsDealt) void refreshCurrentHand();
    if (document.body?.classList.contains("tv-body")) {
      pulseTvCenter("is-broadcast-highlight", 820);
      playSound("round");
    } else {
      publishRoundLifecycleAlerts(event);
    }
    if (event.payload?.gameFinished && !document.body?.classList.contains("tv-body")) {
      publishGameResult({
        id: Number.isFinite(event.id) ? `final-placements-${event.id}` : "final-placements",
        icon: "🏆",
        category: "GAME COMPLETE",
        tone: "success",
        title: "Three Rounds Complete",
        summary: "Final player placements are now available on the table.",
        details: "Review the rankings together and choose the winner at your table."
      });
    }
  } else if (event.type === "RESOLVE_COIN_REQUEST") {
    const request = event.payload;
    if (assignedCountry && cleanStr(request.country) === cleanStr(assignedCountry.name)) {
      if (request.approved) {
        coins = Number(request.coins) || coins;
        updateUI();
        logAction(`✅ Host Approved your coin purchase! Your server wallet now holds ${coins} coins.`, "BANK");
      } else {
        logAction("❌ Host Rejected your coin purchase request.", "BANK");
      }
    }
    const matchingRequest = pendingCoinRequests.findIndex(item =>
      item.requestId === request.requestId
    );
    if (matchingRequest >= 0) pendingCoinRequests.splice(matchingRequest, 1);
    renderHostCoinRequests();
    syncCoinPurchaseControl();
  } else if (event.type === "LOCK_RESOURCES") {
    if (event.payload?.country) {
      lockedPlayersSet.add(cleanStr(event.payload.country));
      updateReadyConsensusUI();
      syncHostButtonsUI();
      void refreshRoomSnapshot();
      window.setTimeout(() => pulseTvSeat(event.payload.country, "is-locked-highlight"), 260);
      playSound("lock");
    }
  } else if (event.type === "SET_READY") {
    const country = cleanStr(event.payload?.country || "");
    if (event.payload?.ready) readyPlayersSet.add(country);
    else readyPlayersSet.delete(country);
    if (assignedCountry && country === cleanStr(assignedCountry.name)) {
      isLocalPlayerReadyToClose = Boolean(event.payload?.ready);
    }
    updateReadyConsensusUI();
    window.setTimeout(() => pulseTvSeat(event.payload?.country, "is-ready-highlight"), 120);
    if (event.payload?.ready) {
      const seatedCount = roomSeatsState.filter(player => player.taken).length;
      const everyoneReady = seatedCount > 0 && readyPlayersSet.size >= seatedCount;
      playSound(everyoneReady ? "allReady" : "ready");
      if (everyoneReady) pulseTvCenter("is-ready-center-highlight", 800);
    }
  } else if (event.type === "REQUEST_COINS") {
    pendingCoinRequests.push(event.payload);
    if (
      assignedCountry &&
      cleanStr(event.payload?.country) === cleanStr(assignedCountry.name) &&
      Number.isFinite(Number(event.payload?.requestCount))
    ) {
      coinRequestsUsed = Number(event.payload.requestCount);
    }
    renderHostCoinRequests();
    syncCoinPurchaseControl();
  } else if (event.type === "ACTIVATE_GENERAL") {
    applyGeneralAllowance(event.payload);
    renderCommandBoard();
  } else if (event.type === "TAKE_BANKER_LOAN") {
    if (assignedCountry && cleanStr(event.payload?.country) === cleanStr(assignedCountry.name)) {
      coins = Number(event.payload.coins) || 0;
      loans = Number(event.payload.loans) || 0;
      loanInterest = Number(event.payload.loanInterest) || 0;
      void refreshCurrentHand();
      updateUI();
    }
  } else if (event.type === "REPAY_BANKER_LOAN") {
    if (assignedCountry && cleanStr(event.payload?.country) === cleanStr(assignedCountry.name)) {
      coins = Number(event.payload.coins) || 0;
      loans = Number(event.payload.loans) || 0;
      loanInterest = Number(event.payload.loanInterest) || 0;
      updateUI();
      void refreshRoomSnapshot();
      logAction(`🏦 Banker loan settled: ${event.payload.repayment} coins paid, including interest.`, "BANK");
    }
  } else if (event.type === "ACTIVATE_MERCHANT") {
    if (assignedCountry && cleanStr(event.payload?.country) === cleanStr(assignedCountry.name)) {
      isMerchantActive = true;
      void refreshCurrentHand();
      updateUI();
    }
  } else if (event.type === "ATOMIC_STRIKE") {
    if (assignedCountry && cleanStr(event.payload?.targetCountry) === cleanStr(assignedCountry.name)) {
      const destroyedAmount = Number(event.payload.destroyed) || 0;
      const remainingAmount = Number(event.payload.remaining);
      investments[event.payload.targetField] = Number.isFinite(remainingAmount)
        ? remainingAmount
        : Math.max(0, (investments[event.payload.targetField] || 0) - destroyedAmount);
      const slider = document.getElementById(`slider-${event.payload.targetField}`);
      if (slider) slider.value = investments[event.payload.targetField];
      updateUI();
    }
    void refreshRoomSnapshot();
    startSoundLoop("atomicLoop", { duration: 3400, interval: 620 });
    showTvAtomicCloud(event.payload.targetCountry);
    publishGameResult({
      id: Number.isFinite(event.id)
        ? `atomic-strike-${event.id}`
        : `atomic-strike-${event.payload.attackerCountry}-${event.payload.targetCountry}-${event.payload.targetField}`,
      icon: "☢️",
      category: "ATOMIC BOMB RESULT",
      tone: "danger",
      title: "Atomic Strike Detonated",
      summary: `${event.payload.attackerCountry} launched an Atomic Bomb against ${event.payload.targetCountry}.`,
      details: `${event.payload.targetField} investments destroyed: ${event.payload.destroyed}.`
    });
    pulseTvSeat(event.payload.targetCountry, "is-combat-highlight");
    pulseTvSeat(event.payload.attackerCountry, "is-combat-highlight");
    playTvTableLink(event.payload.attackerCountry, event.payload.targetCountry, "atomic");
  } else if (event.type === "PROPOSE_TRADE") {
    const myAssets = assignedCountry ? event.payload?.assets?.[assignedCountry.name] : null;
    if (myAssets) {
      coins = Number(myAssets.coins) || 0;
      if (myAssets.investments) investments = { ...myAssets.investments };
      updateUI();
    }
    if (assignedCountry && cleanStr(event.payload?.targetCountry) === cleanStr(assignedCountry.name)) {
      pendingTradeProposal = event.payload;
      updateAllianceUI();
    }
    pulseTvSeat(event.payload?.proposerCountry, "is-trade-highlight");
    pulseTvSeat(event.payload?.targetCountry, "is-trade-highlight");
    playTvTableLink(event.payload?.proposerCountry, event.payload?.targetCountry, "trade");
    startSoundLoop("tradeLoop", { duration: 2600, interval: 680 });
    void refreshRoomSnapshot();
  } else if (event.type === "RESPOND_TRADE") {
    const myAssets = assignedCountry ? event.payload?.assets?.[assignedCountry.name] : null;
    if (myAssets) {
      coins = Number(myAssets.coins) || 0;
      if (myAssets.investments) {
        investments = { ...myAssets.investments };
        ["agri", "oil", "mines"].forEach(field => {
          const slider = document.getElementById(`slider-${field}`);
          if (slider) slider.value = investments[field];
        });
      }
      updateUI();
    }
    pendingTradeProposal = null;
    pendingOutgoingTrade = null;
    updateAllianceUI();
    stopSoundLoop("tradeLoop");
    publishGameResult({
      id: Number.isFinite(event.id)
        ? `trade-response-${event.id}`
        : `trade-response-${event.payload.proposalId}`,
      icon: event.payload.approved ? "🤝" : "❌",
      category: "TRADE RESULT",
      tone: event.payload.approved ? "success" : "danger",
      title: event.payload.approved ? "Trade Completed" : "Trade Rejected",
      summary: event.payload.approved
        ? `${event.payload.proposerCountry} and ${event.payload.targetCountry} completed their exchange.`
        : `${event.payload.targetCountry} declined the trade from ${event.payload.proposerCountry}.`,
      details: event.payload.approved ? "Server wallet balances have been updated." : "No server wallet balances changed."
    });
    pulseTvSeat(event.payload.proposerCountry, "is-trade-highlight");
    pulseTvSeat(event.payload.targetCountry, "is-trade-highlight");
    playTvTableLink(event.payload.proposerCountry, event.payload.targetCountry, "trade");
    void refreshRoomSnapshot();
  } else if (event.type === "SPY_INTERRUPT") {
    const myAssets = assignedCountry ? event.payload?.assets?.[assignedCountry.name] : null;
    if (myAssets) {
      coins = Number(myAssets.coins) || 0;
      if (myAssets.investments) {
        investments = { ...myAssets.investments };
        ["agri", "oil", "mines"].forEach(field => {
          const slider = document.getElementById(`slider-${field}`);
          if (slider) slider.value = investments[field];
        });
      }
      updateUI();
    }
    void refreshCurrentHand();
    if (pendingTradeProposal?.id === event.payload.proposalId) {
      pendingTradeProposal = null;
      updateAllianceUI();
    }
    publishGameResult({
      id: Number.isFinite(event.id)
        ? `spy-interrupt-${event.id}`
        : `spy-interrupt-${event.payload.proposalId}`,
      icon: "🕵️",
      category: "SPY CARD RESULT",
      tone: "danger",
      title: "Spy Operation Successful",
      summary: event.payload.resolution === "reversed"
        ? `${event.payload.country} broke the finalized trade between ${event.payload.proposerCountry} and ${event.payload.targetCountry}.`
        : `${event.payload.country} cancelled the pending trade between ${event.payload.proposerCountry} and ${event.payload.targetCountry}.`,
      details: event.payload.resolution === "reversed"
        ? "Both countries' trade assets were restored to their pre-trade state."
        : "The proposer’s escrowed asset was returned."
    });
    void refreshRoomSnapshot();
  } else if (event.type === "HITMAN_STRIKE") {
    const attackerCountry = event.payload?.attackerCountry || "An opposing commander";
    const targetCountry = event.payload?.targetCountry || "an opposing country";
    const succeeded = Boolean(event.payload?.succeeded);
    const publicMessage = succeeded
      ? `🕶️ Hitman action: ${attackerCountry} disabled one proficiency card held by ${targetCountry}.`
      : `🕶️ Hitman action: ${attackerCountry} targeted ${targetCountry}, but no matching card was found.`;
    logAction(publicMessage, "CARD");
    publishGameResult({
      id: Number.isFinite(event.id) ? `hitman-${event.id}` : `hitman-${attackerCountry}-${targetCountry}`,
      icon: "🕶️",
      category: "HITMAN RESULT",
      tone: succeeded ? "danger" : "neutral",
      title: succeeded ? "Hitman Operation Successful" : "Hitman Operation Failed",
      summary: `${attackerCountry} targeted ${targetCountry}.`,
      details: succeeded
        ? "One General or Spy card was disabled. The targeted card type remains private."
        : "No matching General or Spy card was found, so no proficiency card was disabled."
    });
    if (
      succeeded &&
      assignedCountry &&
      cleanStr(targetCountry) === cleanStr(assignedCountry.name)
    ) {
      void refreshCurrentHand();
      playSound("warning");
    }
    void refreshRoomSnapshot();
  } else if (event.type === "SOLO_SKIRMISH") {
    applySoloSkirmishResult(event.payload, event.id);
    void refreshRoomSnapshot();
  } else if (event.type === "ALLIANCE_SKIRMISH" || event.type.endsWith("_ALLIANCE")) {
    handleAllianceRoomEvent(event);
    void refreshRoomSnapshot();
  }
}

async function submitHostCommand(type, payload) {
  if (!isRoomCreator || typeof fetch !== "function") return false;

  try {
    const response = await fetch(editionApiPath("/api/host/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type, payload, edition: activeEdition })
    });
    const data = await response.json();
    if (!response.ok) {
      logAction(`⛔ ${data.error || "The server rejected this host action."}`, "HOST");
      playSound("warning");
      syncHostAccessUI();
      return false;
    }
    (Array.isArray(data.events) ? data.events : [data.event]).forEach(applyHostEvent);
    return true;
  } catch (e) {
    logAction("⛔ Could not contact the game server for this host action.", "HOST");
    playSound("warning");
    return false;
  }
}

async function submitRoomEvent(type, payload) {
  if (typeof fetch !== "function") return false;

  try {
    const response = await fetch(editionApiPath("/api/room/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type, payload })
    });
    const data = await response.json();
    if (!response.ok) {
      logAction(`⛔ ${data.error || "The server rejected this room event."}`, "ALLIANCE");
      playSound("warning");
      return false;
    }
    (Array.isArray(data.events) ? data.events : [data.event]).forEach(applyHostEvent);
    if (data.hitmanResult) handleHitmanResult(data.hitmanResult);
    return true;
  } catch (e) {
    logAction("⛔ Could not contact the game server for this alliance action.", "ALLIANCE");
    playSound("warning");
    return false;
  }
}

function startHostEventPolling() {
  if (hostEventPollingStarted || typeof fetch !== "function" || typeof setInterval !== "function") return;
  hostEventPollingStarted = true;

  setInterval(async () => {
    if (hostPollInFlight) return;
    hostPollInFlight = true;
    try {
      const response = await fetch(editionApiPath(`/api/events?after=${lastHostEventId}`), { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      data.events?.forEach(applyHostEvent);
    } catch (e) {
    } finally {
      hostPollInFlight = false;
    }
  }, 900);
}

function syncHostButtonsUI() {
  const dealBtn = document.getElementById("btn-host-deal");
  const eventBtn = document.getElementById("btn-host-event");
  const advanceBtn = document.getElementById("btn-host-advance");
  const restartBtn = document.getElementById("btn-host-restart");
  const resetBtn = document.getElementById("btn-host-reset");

  const labels = translations[currentLang] || translations.en;

  if (dealBtn) {
    dealBtn.classList.add("hidden");
  }

  if (eventBtn) {
    eventBtn.classList.add("hidden");
  }

  if (advanceBtn) {
    advanceBtn.disabled = !isRoomCreator || gameFinished;
    advanceBtn.textContent = gameFinished ? "Game Complete" : "Close & Calculate Round";
  }

  if (restartBtn) {
    restartBtn.classList.toggle("hidden", !isRoomCreator || !gameFinished);
    restartBtn.disabled = !isRoomCreator || !gameFinished;
  }

  if (resetBtn) {
    resetBtn.disabled = !isRoomCreator;
  }
}

function initializeRoomCreator(session) {
  isRoomCreator = Boolean(session?.player?.isHost);
  syncHostAccessUI();
}

function syncHostAccessUI() {
  const hostButton = document.getElementById("btn-mode-host");
  const hostPanel = document.getElementById("host-panel");

  hostButton?.classList.toggle("hidden", !isRoomCreator);
  hostButton?.setAttribute(
    "aria-hidden",
    isRoomCreator ? "false" : "true"
  );

  if (!isRoomCreator) {
    activeMode = "player";
    hostPanel?.classList.add("hidden");
    document.getElementById("btn-mode-player")?.classList.add("active");
    hostButton?.classList.remove("active");
  }
}

function requireRoomCreator(actionLabel) {
  if (isRoomCreator) return true;

  switchMode("player");
  logAction(`⛔ Only the room creator can ${actionLabel}.`, "HOST");
  return false;
}

function isGlobalConditionActive(conditionId) {
  return activeGlobalCondition?.id === conditionId;
}

function getEffectiveResourceMultiplier(field, baseMultiplier = countryMultipliers[field]) {
  if (
    activeGlobalCondition?.id === "pandemic" &&
    (
      !["agri", "oil", "mines"].includes(activeGlobalCondition.field) ||
      activeGlobalCondition.field === field
    )
  ) {
    return 1;
  }
  if (
    activeGlobalCondition?.id === "global-warming" &&
    (field === "agri" || field === "oil")
  ) {
    return Number((baseMultiplier * activeGlobalCondition[field === "agri"
      ? "agricultureIncomeMultiplier"
      : "oilIncomeMultiplier"]).toFixed(1));
  }
  return baseMultiplier || 1;
}

const resourceFieldOptionMeta = {
  unallocated: { icon: "💰", name: "Unallocated Cash Balance" },
  agri: { icon: "🌾", name: "Agriculture" },
  oil: { icon: "🛢️", name: "Oil" },
  mines: { icon: "⛏️", name: "Mines" }
};

function formatResourceMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
}

function multiplierForCountryField(country, field) {
  const base = getCountryRoundMultipliers(country, activeCountryCard(country));
  return getEffectiveResourceMultiplier(field, base[field]);
}

function updateResourceSelectOptions(selectId, country, suffix = " Field") {
  const select = document.getElementById(selectId);
  if (!select) return;

  Array.from(select.options).forEach(option => {
    const field = option.value;
    const meta = resourceFieldOptionMeta[field];
    if (!meta) return;
    if (field === "unallocated") {
      option.textContent = `${meta.icon} ${meta.name}`;
      return;
    }
    const multiplier = country
      ? ` (×${formatResourceMultiplier(multiplierForCountryField(country, field))})`
      : " (target not selected)";
    option.textContent = `${meta.icon} ${meta.name}${suffix}${multiplier}`;
  });
}

function selectedAllianceTargetCountry() {
  const selected = document.getElementById("select-alliance-skirmish-target")?.value || "";
  const target = allianceCombatTargets.find(item => `${item.kind}:${item.id}` === selected);
  if (!target) return "";
  if (target.kind === "solo") return target.id;
  return [activePresidentCoalition, activeCounterUnion]
    .find(alliance => alliance?.proposalId === target.id)
    ?.initiator || "";
}

window.updateResourceSelectorLabels = function() {
  const ownCountry = assignedCountry?.name || "";
  const tradePartner = document.getElementById("select-trade-partner")?.value || "";
  const soloTarget = document.getElementById("select-skirmish-target-country")?.value || "";
  const allianceTarget = selectedAllianceTargetCountry();
  const atomicTarget = document.getElementById("select-atomic-target-country")?.value || "";

  updateResourceSelectOptions("select-offer-field", ownCountry, " Investment");
  updateResourceSelectOptions("select-request-field", tradePartner, " Investment");
  updateResourceSelectOptions("select-skirmish-target-field", soloTarget);
  updateResourceSelectOptions("select-alliance-skirmish-field", allianceTarget);

  const atomicField = document.getElementById("select-atomic-target-field");
  if (atomicField) {
    Array.from(atomicField.options).forEach(option => {
      const field = {
        Agriculture: "agri",
        Oil: "oil",
        Mines: "mines"
      }[option.value];
      const meta = resourceFieldOptionMeta[field];
      if (!meta) return;
      const multiplier = atomicTarget
        ? ` (×${formatResourceMultiplier(multiplierForCountryField(atomicTarget, field))})`
        : " (target not selected)";
      option.textContent = `${meta.icon} ${meta.name}${multiplier}`;
    });
  }
};

function renderActiveGlobalCondition() {
  const banner = document.getElementById("global-event-banner");
  const tvTicker = document.getElementById("tv-status-ticker");
  const tableCenter = document.querySelector(".table-center-pot");

  if (!activeGlobalCondition) {
    if (banner) {
      banner.style.display = "none";
      banner.classList.add("hidden");
    }
    if (tvTicker) tvTicker.textContent = "No active Global Condition this round.";
    tableCenter?.classList.remove("has-global-condition");
    return;
  }

  if (banner) {
    banner.classList.remove("hidden");
    banner.style.display = "block";
    setTxt("global-event-name", activeGlobalCondition.title);
    setTxt("global-event-desc", activeGlobalCondition.desc);
  }

  if (tvTicker) {
    tvTicker.textContent = `GLOBAL CONDITION: ${activeGlobalCondition.title} — ${activeGlobalCondition.desc}`;
  }
  tableCenter?.classList.add("has-global-condition");
}

function activateGlobalCondition(condition) {
  activeGlobalCondition = describeGlobalCondition(condition);

  try {
    if (activeGlobalCondition) {
      localStorage.setItem("world_war_active_global_condition", JSON.stringify(activeGlobalCondition));
    } else {
      localStorage.removeItem("world_war_active_global_condition");
    }
  } catch (e) {}

  renderActiveGlobalCondition();
  renderHand();
  renderTvRoster();
  renderCommandBoard();
  updateTradePreview();
  updateResourceSelectorLabels();
  updateCountryUI();
  updateAllianceUI();
}

function clearActiveGlobalCondition() {
  activateGlobalCondition(null);
}

// ==========================================
// SESSION SETUP
// ==========================================
function applyServerHand(hand) {
  if (!Array.isArray(hand)) return;
  currentHand = hand
    .map(title => cardDeck.find(card => card.title === title))
    .filter(card => card && (!isSimpleEdition() || !["Banker", "President"].includes(card.title)));
  renderHand();
}

async function refreshCurrentHand() {
  try {
    const response = await fetch(editionApiPath("/api/session"), { credentials: "same-origin" });
    if (!response.ok) return;
    const session = await response.json();
    applyServerHand(session.hand);
  } catch (e) {}
}

async function initMobilePlayerSession() {
  let session;
  try {
    const response = await fetch(editionApiPath("/api/session"), { credentials: "same-origin" });
    if (!response.ok) {
      window.location.href = `index.html?${editionQuery()}`;
      return;
    }
    session = await response.json();
    if (!session.player) {
      window.location.href = `index.html?${editionQuery()}`;
      return;
    }
  } catch (e) {
    setTxt("action-log", "Unable to connect to the game server.");
    return;
  }

  const handleName = session.player.handle;
  applyEditionUi(session.edition || activeEdition);
  assignedCountry = countryCards.find(card => cleanStr(card.name) === cleanStr(session.player.country));
  if (!assignedCountry) return;

  countryMultipliers = { agri: assignedCountry.agri, oil: assignedCountry.oil, mines: assignedCountry.mines };
  registeredPlayersCount = session.playerCount || 1;
  initializeRoomCreator(session);
  activePresidentCoalition = null;
  activeCounterUnion = null;
  pendingAllianceProposal = null;
  pendingTradeProposal = null;
  applyServerHand(session.hand);
  applyRoomSnapshot(session.room);
  if (session.economy) {
    coins = Number(session.economy.coins) || 0;
    loans = Number(session.economy.loans) || 0;
    loanInterest = Number(session.economy.loanInterest) || 0;
    coinRequestsUsed = Math.max(0, Number(session.economy.coinRequestsUsed) || 0);
    if (session.economy.lastSettlement?.fieldYields) {
      lastRoundSettlement = session.economy.lastSettlement;
    }
    if (session.economy.investments) {
      investments = { ...session.economy.investments };
      investmentsLocked = true;
    }
    if (session.economy.battleAllowance) {
      skirmishAttacksExecuted = Number(session.economy.battleAllowance.attacksUsed) || 0;
      skirmishMaxAllowedAttacks = Number(session.economy.battleAllowance.maxAttacks) || 1;
    }
  }

  gameActivityLedger = safeStorageGet("world_war_round_announcements", []);
  soundManager.init();
  renderRoundAnnouncements();

  const savedLang = (() => {
    try {
      const storedLang = localStorage.getItem("selected_lang");
      return translations[storedLang] ? storedLang : "en";
    } catch (e) {
      return "en";
    }
  })();
  const langSelect = document.getElementById("lang-select");
  if (langSelect) langSelect.value = savedLang;

  // Attach language manually if not bound
  if(typeof window.changeLanguage === "function") window.changeLanguage(savedLang);

  updateCountryUI();
  updateUI();
  syncHostAccessUI();
  syncHostButtonsUI();
  updateReadyConsensusUI();
  logAction(`Welcome ${handleName}! Your wallet is synchronized with the game server.`, "SYSTEM");
  startHostEventPolling();
}

window.initController = initMobilePlayerSession;

function updateCountryUI() {
  if (!assignedCountry) return;
  setTxt("mult-agri", getEffectiveResourceMultiplier("agri"));
  setTxt("mult-oil", getEffectiveResourceMultiplier("oil"));
  setTxt("mult-mines", getEffectiveResourceMultiplier("mines"));
}

function commandBoardCopy() {
  return translations[currentLang] || translations.en;
}

function commandBoardAlliance(country) {
  return [activePresidentCoalition, activeCounterUnion].find(alliance =>
    Array.isArray(alliance?.members) &&
    alliance.members.some(member => cleanStr(member) === cleanStr(country))
  ) || null;
}

function commandBoardStatus(player, copy) {
  if (player.ready) return copy.txtBoardReady;
  if (player.locked) return copy.txtBoardLocked;
  return copy.txtBoardPlanning;
}

function commandBoardTotalInvestment(player) {
  if (player?.totalInvestment == null) return null;
  const total = Number(player?.totalInvestment);
  return Number.isFinite(total) ? Math.max(0, total) : null;
}

function renderCommandBoardResource(icon, label, multiplier) {
  const resource = document.createElement("span");
  resource.className = "command-board-resource";
  resource.textContent = `${icon} ×${multiplier}`;
  resource.title = `${label} multiplier ×${multiplier}`;
  return resource;
}

function renderCommandBoardDetails(player) {
  const details = document.getElementById("command-board-details");
  if (!details) return;
  const copy = commandBoardCopy();
  details.replaceChildren();

  if (!player) {
    const empty = document.createElement("p");
    empty.textContent = copy.txtBoardDetailsEmpty;
    details.appendChild(empty);
    return;
  }

  const intelHidden = isCountryIntelHiddenByBlackout(player.country);
  const card = activeCountryCard(player.country);
  const multipliers = intelHidden ? null : getCountryRoundMultipliers(player.country, card);
  const totalInvestment = commandBoardTotalInvestment(player);
  const alliance = commandBoardAlliance(player.country);
  const title = document.createElement("div");
  title.className = "command-board-detail-heading";
  const country = document.createElement("strong");
  country.textContent = player.country;
  const state = document.createElement("span");
  state.className = `command-board-state ${player.ready ? "is-ready" : player.locked ? "is-locked" : "is-planning"}`;
  state.textContent = commandBoardStatus(player, copy);
  title.append(country, state);

  const commander = document.createElement("p");
  commander.className = "command-board-commander";
  commander.textContent = `${player.handle}${player.isHost ? " · Host" : ""}`;

  const resources = document.createElement("div");
  resources.className = "command-board-detail-resources";
  if (intelHidden) {
    resources.textContent = copy.txtBlackoutHidden;
  } else {
    [
      ["🌾", "Farm", "agri"],
      ["🛢️", "Oil", "oil"],
      ["⛏️", "Mines", "mines"]
    ].forEach(([icon, label, field]) => {
      resources.appendChild(
        renderCommandBoardResource(
          icon,
          label,
          getEffectiveResourceMultiplier(field, multipliers[field])
        )
      );
    });
  }

  const context = document.createElement("p");
  context.className = "command-board-context";
  const contextParts = [
    intelHidden
      ? copy.txtBoardBlackout
      : totalInvestment == null
      ? copy.txtBoardTotalPending
      : copy.txtBoardTotalInvestment.replace("{total}", totalInvestment)
  ];
  if (alliance) contextParts.push(`${copy.txtBoardAlliance}: ${alliance.allianceType}`);
  if (activeGlobalCondition) contextParts.push(activeGlobalCondition.title.replace(/^[^\s]+\s/, ""));
  context.textContent = contextParts.join(" · ");

  const actions = document.createElement("div");
  actions.className = "command-board-actions";
  const actActionsLocked = !isActPhaseReady();
  const actionLockMessage = actActionLockMessage();
  const trade = document.createElement("button");
  trade.type = "button";
  trade.className = "btn btn-secondary btn-small";
  const tradesRemaining = Math.max(0, fieldTradeAttemptLimit - fieldTradeAttemptsUsed);
  trade.textContent = `${copy.txtBoardTrade} (${tradesRemaining} left)`;
  trade.disabled = gameFinished || actActionsLocked || tradesRemaining === 0;
  trade.title = actActionsLocked
    ? actionLockMessage
    : tradesRemaining === 0
    ? "You have used both Field Trade proposals for this round."
    : "Open a Field Trade proposal.";
  trade.onclick = window.openCommandBoardTrade;

  const battle = document.createElement("button");
  battle.type = "button";
  battle.className = "btn btn-danger btn-small";
  const blockedByLoan = bankerRepaymentDue() > 0;
  const battlesRemaining = Math.max(0, skirmishMaxAllowedAttacks - skirmishAttacksExecuted);
  battle.textContent = blockedByLoan
    ? copy.txtBoardBattleLoanLocked
    : `${copy.txtBoardBattle} (${battlesRemaining} left)`;
  battle.disabled = gameFinished || actActionsLocked || !investmentsLocked || !player.locked || blockedByLoan || battlesRemaining === 0;
  battle.title = actActionsLocked
    ? actionLockMessage
    : blockedByLoan
    ? copy.txtBattleLoanGate
    : battlesRemaining === 0
      ? "You have used all Field Battles allowed this round."
    : battle.disabled
      ? "Both countries must lock investments before a field battle."
      : "Open a Field Battle against this country.";
  battle.onclick = window.openCommandBoardBattle;
  const guidance = document.createElement("p");
  guidance.className = "command-board-action-guidance";
  guidance.id = "command-board-action-guidance";
  guidance.setAttribute("role", "status");
  guidance.textContent = actActionsLocked
    ? actionLockMessage
    : blockedByLoan
    ? copy.txtBoardBattleLoanLocked
    : battlesRemaining === 0
      ? copy.txtBoardBattleUsed
      : trade.disabled
        ? copy.txtBoardTradeUsed
        : battle.disabled
          ? copy.txtBoardBattleLocked
          : copy.txtBoardActionsAvailable;
  trade.setAttribute("aria-describedby", guidance.id);
  battle.setAttribute("aria-describedby", guidance.id);
  actions.append(trade, battle);

  details.append(title, commander, resources, context, actions, guidance);
}

function renderCommandBoard() {
  const surface = document.getElementById("command-board-surface");
  const condition = document.getElementById("command-board-condition");
  const actLockNotice = document.getElementById("act-phase-lock-notice");
  const prepareIncomplete = !isPrepareCompleteForAct();
  if (actLockNotice) {
    actLockNotice.hidden = !prepareIncomplete;
    actLockNotice.textContent = prepareIncomplete
      ? (translations[currentLang] || translations.en).txtActActionsLocked
      : "";
  }
  document.getElementById("tab-panel-act")?.classList.toggle("is-actions-locked", prepareIncomplete);
  if (!surface) return;
  const copy = commandBoardCopy();
  const selfCountry = cleanStr(assignedCountry?.name || "");
  const opponentPlayers = activeRoomPlayers.filter(player =>
    player?.country && cleanStr(player.country) !== selfCountry
  );

  if (condition) {
    condition.textContent = activeGlobalCondition
      ? activeGlobalCondition.title
      : copy.txtBoardConditionClear;
    condition.classList.toggle("is-active", Boolean(activeGlobalCondition));
  }

  if (!opponentPlayers.some(player => cleanStr(player.country) === cleanStr(selectedBoardCountry))) {
    selectedBoardCountry = opponentPlayers[0]?.country || "";
  }

  const signature = JSON.stringify({
    condition: activeGlobalCondition?.id || "",
    selected: selectedBoardCountry,
    players: opponentPlayers.map(player => ({
      country: player.country,
      locked: player.locked,
      ready: player.ready,
      intelHidden: isCountryIntelHiddenByBlackout(player.country),
      total: isCountryIntelHiddenByBlackout(player.country) ? null : player.totalInvestment,
      multipliers: isCountryIntelHiddenByBlackout(player.country)
        ? null
        : getCountryRoundMultipliers(player.country, activeCountryCard(player.country)),
      alliance: commandBoardAlliance(player.country)?.allianceType || ""
    }))
  });
  const stateChanged = Boolean(commandBoardStateSignature && commandBoardStateSignature !== signature);
  commandBoardStateSignature = signature;

  surface.replaceChildren();
  surface.classList.toggle("has-global-condition", Boolean(activeGlobalCondition));
  if (!opponentPlayers.length) {
    const empty = document.createElement("p");
    empty.className = "command-board-empty";
    empty.textContent = copy.txtBoardEmpty;
    surface.appendChild(empty);
    renderCommandBoardDetails(null);
    return;
  }

  opponentPlayers.forEach((player, index) => {
    const intelHidden = isCountryIntelHiddenByBlackout(player.country);
    const card = activeCountryCard(player.country);
    const multipliers = intelHidden ? null : getCountryRoundMultipliers(player.country, card);
    const totalInvestment = commandBoardTotalInvestment(player);
    const alliance = commandBoardAlliance(player.country);
    const isSelected = cleanStr(player.country) === cleanStr(selectedBoardCountry);
    const territory = document.createElement("button");
    territory.type = "button";
    territory.className = `command-territory ${player.ready ? "is-ready" : player.locked ? "is-locked" : "is-planning"}${isSelected ? " is-selected" : ""}${alliance ? " is-allied" : ""}`;
    territory.style.setProperty("--territory-index", String(index));
    territory.style.setProperty("--territory-y", index % 2 ? "5px" : "0px");
    territory.dataset.country = player.country;
    territory.setAttribute("aria-pressed", String(isSelected));
    territory.setAttribute(
      "aria-label",
      `${player.country}, ${commandBoardStatus(player, copy)}`
    );
    territory.onclick = () => {
      selectedBoardCountry = player.country;
      renderCommandBoard();
      playSound("ui");
    };

    const state = document.createElement("span");
    state.className = "command-territory-state";
    state.textContent = player.ready ? "READY" : player.locked ? "LOCKED" : "PLAN";
    const name = document.createElement("strong");
    name.className = "command-territory-name";
    name.textContent = player.country;
    const commander = document.createElement("span");
    commander.className = "command-territory-commander";
    commander.textContent = `${player.handle}${player.isHost ? " · Host" : ""}`;
    const resources = document.createElement("span");
    resources.className = "command-territory-resources";
    if (intelHidden) {
      resources.textContent = copy.txtBlackoutHidden;
    } else {
      [
        ["🌾", "Farm", "agri"],
        ["🛢️", "Oil", "oil"],
        ["⛏️", "Mines", "mines"]
      ].forEach(([icon, label, field]) => {
        resources.appendChild(
          renderCommandBoardResource(
            icon,
            label,
            getEffectiveResourceMultiplier(field, multipliers[field])
          )
        );
      });
    }
    const total = document.createElement("span");
    total.className = "command-territory-total";
    total.textContent = intelHidden
      ? copy.txtBoardBlackout
      : totalInvestment == null
      ? copy.txtBoardTotalPending
      : copy.txtBoardTotalInvestment.replace("{total}", totalInvestment);
    if (alliance) {
      const allianceBadge = document.createElement("span");
      allianceBadge.className = "command-territory-alliance";
      allianceBadge.textContent = alliance.allianceType === "Mega-Merger" ? "MEGA" : "UNION";
      territory.appendChild(allianceBadge);
    }
    territory.append(state, name, commander, resources, total);
    surface.appendChild(territory);
  });

  const selectedPlayer = opponentPlayers.find(player => cleanStr(player.country) === cleanStr(selectedBoardCountry));
  renderCommandBoardDetails(selectedPlayer);
  if (stateChanged) pulseVisual(surface, "is-state-updated", 680);
}

function setCommandBoardTarget(selectId) {
  const select = document.getElementById(selectId);
  if (!select || !selectedBoardCountry) return;
  const option = Array.from(select.options).find(item => cleanStr(item.value) === cleanStr(selectedBoardCountry));
  if (option) select.value = option.value;
}

window.openCommandBoardTrade = function() {
  if (!requireActPhase()) return;
  window.openTradeModal();
  setCommandBoardTarget("select-trade-partner");
};

window.openCommandBoardBattle = function() {
  if (!requireActPhase()) return;
  window.openSkirmishModal();
  setCommandBoardTarget("select-skirmish-target-country");
};

window.switchMode = function(mode) {
  const nextMode = mode === "host" && !isRoomCreator ? "player" : mode;
  activeMode = nextMode;
  document.getElementById("btn-mode-player")?.classList.toggle("active", nextMode === 'player');
  document.getElementById("btn-mode-host")?.classList.toggle("active", nextMode === 'host');
  document.getElementById("host-panel")?.classList.toggle("hidden", nextMode !== 'host' || !isRoomCreator);
};

// ==========================================
// ROUND CLOSING CONSENSUS SYSTEM
// ==========================================
window.togglePlayerReadyToClose = async function() {
  if (!investmentsLocked) {
    logAction("🔒 Lock your field investments before marking ready for the next round.", "ROUND");
    updateReadyConsensusUI();
    return;
  }

  const nextReady = !isLocalPlayerReadyToClose;
  const saved = await submitRoomEvent("SET_READY", { ready: nextReady });
  if (!saved) return;
  isLocalPlayerReadyToClose = nextReady;

  const btn = document.getElementById("btn-player-ready");
  const myCountry = assignedCountry ? assignedCountry.name : "Player";

  if (isLocalPlayerReadyToClose) {
    readyPlayersSet.add(cleanStr(myCountry));
    if (btn) {
      btn.textContent = "✅ Waiting for Host to Close Round...";
      btn.className = "btn btn-secondary btn-large";
    }
    logAction(`🏁 You marked yourself READY to close Round ${currentRound}.`, "ROUND");
    pulseVisual(document.querySelector(".ready-consensus-card"), "is-event-updated", 460);
  } else {
    readyPlayersSet.delete(cleanStr(myCountry));
    if (btn) {
      btn.textContent = (translations[currentLang] || translations.en).btnReadyNextRound;
      btn.className = "btn btn-success btn-large";
    }
    logAction(`🔄 You CANCELLED your ready status for Round ${currentRound}.`, "ROUND");
  }

  if (gameBroadcast) {
    gameBroadcast.postMessage({
      type: "PLAYER_READY_STATUS",
      payload: { country: myCountry, isReady: isLocalPlayerReadyToClose }
    });
  }

  updateReadyConsensusUI();
};

function updateReadyConsensusUI() {
  setTxt("val-ready-count", readyPlayersSet.size);
  setTxt("val-total-players", registeredPlayersCount);

  const readyBtn = document.getElementById("btn-player-ready");
  if (readyBtn) {
    readyBtn.disabled = !investmentsLocked;
    if (!isLocalPlayerReadyToClose) {
      readyBtn.textContent = (translations[currentLang] || translations.en).btnReadyNextRound;
    }
    readyBtn.title = investmentsLocked
      ? "Mark yourself ready after completing this round."
      : "Lock field investments before marking ready.";
  }
  const total = Math.max(1, registeredPlayersCount || 1);
  const progress = Math.min(100, Math.round(readyPlayersSet.size / total * 100));
  const meter = document.getElementById("round-readiness-meter");
  const fill = document.getElementById("round-readiness-fill");
  if (fill) fill.style.width = `${progress}%`;
  if (meter) {
    meter.setAttribute("aria-valuemax", String(total));
    meter.setAttribute("aria-valuenow", String(readyPlayersSet.size));
    meter.classList.toggle("is-complete", readyPlayersSet.size >= total);
  }
  setTxt(
    "round-readiness-label",
    readyPlayersSet.size >= total
      ? "All commanders are ready for the host to close the round."
      : `${readyPlayersSet.size} of ${total} commanders ready`
  );
  document.querySelector(".ready-consensus-card")?.classList.toggle("is-complete", readyPlayersSet.size >= total);
  syncCommanderStatus();
  updateTvRoundStatus();
}

// ==========================================
// DYNAMIC LIVE-UPDATED OFFER SLIDER CAPACITY
// ==========================================
window.updateOfferSliderCapacity = function() {
  const offerField = document.getElementById("select-offer-field")?.value;
  const slider = document.getElementById("slider-offer-amount");
  const maxLabel = document.getElementById("offer-max-label");

  if (!slider || !offerField) return;

  let maxCap = 0;

  if (offerField === 'unallocated') {
    const allocatedCoins = (investments.agri || 0) + (investments.oil || 0) + (investments.mines || 0);
    maxCap = Math.max(0, coins - allocatedCoins);
  } else {
    maxCap = investments[offerField] || 0;
  }

  slider.max = maxCap.toString();
  if (parseInt(slider.value, 10) > maxCap) {
    slider.value = maxCap.toString();
  }

  setTxt("val-offer-amount", slider.value);
  if (maxLabel) maxLabel.textContent = maxCap;
  updateTradePreview();
};

function getTradeFieldLabel(field) {
  if (field === "unallocated") return "unallocated cash";
  return `${field.toUpperCase()} investment`;
}

function getTradeConditionLabel() {
  if (isGlobalConditionActive("pandemic")) return activeGlobalCondition?.desc || "Pandemic multiplier adjustment";
  if (isGlobalConditionActive("economic-recession")) return "Recession reduction included";
  return "No active trade adjustment";
}

window.updateTradePreview = function() {
  const preview = document.getElementById("txt-trade-condition-preview");
  if (!preview) return;

  const offerField = document.getElementById("select-offer-field")?.value || "unallocated";
  const requestField = document.getElementById("select-request-field")?.value || "unallocated";
  const offerAmount = parseInt(document.getElementById("slider-offer-amount")?.value, 10) || 0;
  const requestAmount = parseInt(document.getElementById("slider-request-amount")?.value, 10) || 0;
  const proposerSettlement = calculateTradeSettlement(offerAmount, requestAmount);
  const proposerReceipt = calculateTradeSettlement(0, requestAmount).finalAddAmount;

  preview.textContent = `You escrow ${proposerSettlement.finalDeductAmount} Coins from your ${getTradeFieldLabel(offerField)} and would receive ${proposerReceipt} Coins in ${getTradeFieldLabel(requestField)}. ${getTradeConditionLabel()}.`;
};

window.openTradeModal = function() {
  if (!requireActPhase()) return;
  if (fieldTradeAttemptsUsed >= fieldTradeAttemptLimit) {
    logAction("⚠️ You have used both Field Trade proposals for this round.", "TRADE");
    return;
  }
  const selectPartner = document.getElementById("select-trade-partner");
  if (selectPartner) {
    selectPartner.innerHTML = "";
    liveCountryNames(true).forEach(country => {
      const opt = document.createElement("option");
      opt.value = country;
      opt.textContent = country;
      selectPartner.appendChild(opt);
    });
    if (!selectPartner.options.length) {
      logAction("⚠️ No other seated country is available to trade.", "TRADE");
      return;
    }
  }

  updateResourceSelectorLabels();
  updateOfferSliderCapacity();
  updateTradePreview();
  const tradeButton = document.getElementById("btn-send-trade-proposal");
  if (tradeButton) {
    tradeButton.textContent = `🤝 Send Trade Proposal (${Math.max(0, fieldTradeAttemptLimit - fieldTradeAttemptsUsed)} left)`;
    tradeButton.disabled = fieldTradeAttemptsUsed >= fieldTradeAttemptLimit;
  }
  document.getElementById("trade-modal")?.classList.remove("hidden");
  playSound("ui");
};

window.closeTradeModal = function() {
  document.getElementById("trade-modal")?.classList.add("hidden");
};

function getAvailableTradeAmount(field) {
  if (field === "unallocated") {
    const allocatedCoins = (investments.agri || 0) + (investments.oil || 0) + (investments.mines || 0);
    return Math.max(0, coins - allocatedCoins);
  }

  return Math.max(0, investments[field] || 0);
}

function calculateTradeSettlement(deductAmount, addAmount) {
  const baseDeductAmount = Math.max(0, Number(deductAmount) || 0);
  const baseAddAmount = Math.max(0, Number(addAmount) || 0);
  const merchantBonus = isMerchantActive ? Math.floor(baseAddAmount * 0.10) : 0;
  const tradeIncomeBeforeRecession = baseAddAmount + merchantBonus;
  const recessionMultiplier = isGlobalConditionActive("economic-recession")
    ? activeGlobalCondition.tradeIncomeMultiplier
    : 1;
  const finalDeductAmount = baseDeductAmount;
  const finalAddAmount = Math.floor(tradeIncomeBeforeRecession * recessionMultiplier);

  return {
    finalDeductAmount,
    finalAddAmount,
    pandemicSurcharge: 0,
    recessionReduction: tradeIncomeBeforeRecession - finalAddAmount
  };
}

function reserveTradeEscrow(field, amount) {
  if (getAvailableTradeAmount(field) < amount) return false;

  if (field === "unallocated") {
    coins -= amount;
  } else {
    investments[field] -= amount;
    const slider = document.getElementById(`slider-${field}`);
    if (slider) slider.value = investments[field];
  }

  updateUI();
  return true;
}

function refundTradeEscrow(escrow) {
  if (escrow.field === "unallocated") {
    coins += escrow.amount;
  } else {
    investments[escrow.field] = (investments[escrow.field] || 0) + escrow.amount;
    const slider = document.getElementById(`slider-${escrow.field}`);
    if (slider) slider.value = investments[escrow.field];
  }

  updateUI();
}

window.sendBilateralTradeProposal = async function() {
  const partner = document.getElementById("select-trade-partner")?.value;
  const offerField = document.getElementById("select-offer-field")?.value;
  const offerAmount = parseInt(document.getElementById("slider-offer-amount")?.value, 10) || 0;
  const requestField = document.getElementById("select-request-field")?.value;
  const requestAmount = parseInt(document.getElementById("slider-request-amount")?.value, 10) || 0;

  if (offerField !== "unallocated" && !investmentsLocked) {
    logAction("🔒 Lock your investments before offering a field investment in a trade.", "TRADE");
    return;
  }

  if (!partner || offerAmount <= 0 || requestAmount <= 0) {
    logAction("⚠️ Enter valid offer/request fields and coin amounts.", "TRADE");
    return;
  }

  const proposal = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    proposerCountry: assignedCountry ? assignedCountry.name : "Initiator",
    targetCountry: partner,
    offeredField: offerField,
    offeredAmount: offerAmount,
    requestedField: requestField,
    requestedAmount: requestAmount
  };
  const sent = await submitRoomEvent("PROPOSE_TRADE", proposal);
  if (!sent) return;
  fieldTradeAttemptsUsed = Math.min(fieldTradeAttemptLimit, fieldTradeAttemptsUsed + 1);
  renderCommandBoard();
  pendingOutgoingTrade = { proposalId: proposal.id };
  closeTradeModal();
  logAction(`🤝 Sent a server-validated trade proposal to ${partner}.`, "TRADE");
};

function applyTradeTransfer(deductField, addField, deductAmount, addAmount) {
  const settlement = calculateTradeSettlement(deductAmount, addAmount);
  const {
    finalDeductAmount,
    finalAddAmount,
    pandemicSurcharge,
    recessionReduction
  } = settlement;

  if (getAvailableTradeAmount(deductField) < finalDeductAmount) {
    logAction(`⚠️ Trade could not settle: ${finalDeductAmount} Coins are required from your ${deductField === "unallocated" ? "unallocated balance" : deductField.toUpperCase()} field.`, "TRADE");
    return null;
  }

  if (deductField === 'unallocated') {
    coins -= finalDeductAmount;
  } else {
    investments[deductField] -= finalDeductAmount;
    const dSlider = document.getElementById(`slider-${deductField}`);
    if(dSlider) dSlider.value = investments[deductField];
  }

  if (addField === 'unallocated') {
    coins += finalAddAmount;
  } else {
    investments[addField] = (investments[addField] || 0) + finalAddAmount;
    const aSlider = document.getElementById(`slider-${addField}`);
    if(aSlider) aSlider.value = investments[addField];
  }

  updateUI();

  if (pandemicSurcharge || recessionReduction) {
    const modifiers = [];
    if (pandemicSurcharge) modifiers.push(`Pandemic surcharge: +${pandemicSurcharge}`);
    if (recessionReduction) modifiers.push(`Recession reduction: -${recessionReduction}`);
    logAction(`🌍 Global Condition applied to trade — ${modifiers.join(" · ")} Coins.`, "EVENT");
  }

  return { finalDeductAmount, finalAddAmount, pandemicSurcharge, recessionReduction };
}

window.respondToGenericProposal = async function(approved) {
  if (pendingTradeProposal) {
    const responded = await submitRoomEvent("RESPOND_TRADE", {
      proposalId: pendingTradeProposal.id,
      approved
    });
    if (!responded) return;
    /* Legacy local settlement is intentionally bypassed: the server has published
       the canonical balances for both commanders. */
    if (false) {
      const targetSettlement = calculateTradeSettlement(
        pendingTradeProposal.requestedAmount,
        pendingTradeProposal.offeredAmount
      );

      if (getAvailableTradeAmount(pendingTradeProposal.requestedField) < targetSettlement.finalDeductAmount) {
        logAction(`⚠️ Trade cannot be approved: you need ${targetSettlement.finalDeductAmount} Coins in ${pendingTradeProposal.requestedField === "unallocated" ? "unallocated cash" : pendingTradeProposal.requestedField.toUpperCase()} after active conditions.`, "TRADE");
        publishGameResult({
          icon: "⚠️",
          category: "TRADE RESULT",
          tone: "danger",
          title: "Trade Could Not Settle",
          summary: `${pendingTradeProposal.targetCountry} could not complete the trade with ${pendingTradeProposal.proposerCountry}.`,
          details: `The requested ${getTradeFieldLabel(pendingTradeProposal.requestedField)} amount was unavailable after active condition costs. The proposer’s reserved offer has been returned.`
        });
        if (gameBroadcast) {
          gameBroadcast.postMessage({
            type: "REJECT_TRADE",
            payload: { proposalId: pendingTradeProposal.id }
          });
        }
        pendingTradeProposal = null;
        updateAllianceUI();
        return;
      }

      const settledTrade = applyTradeTransfer(
        pendingTradeProposal.requestedField,
        pendingTradeProposal.offeredField,
        pendingTradeProposal.requestedAmount,
        pendingTradeProposal.offeredAmount
      );

      if (settledTrade && gameBroadcast) {
        gameBroadcast.postMessage({
          type: "EXECUTE_TRADE",
          payload: pendingTradeProposal
        });
      }

      if (settledTrade) {
        logAction(`🤝 TRADE EXECUTED with ${pendingTradeProposal.proposerCountry}! Exchanged assets successfully.`, "TRADE");
        const proposerReceipt = calculateTradeSettlement(0, pendingTradeProposal.requestedAmount).finalAddAmount;
        publishGameResult({
          icon: "🤝",
          category: "TRADE RESULT",
          tone: "success",
          title: "Trade Completed",
          summary: `${pendingTradeProposal.proposerCountry} and ${pendingTradeProposal.targetCountry} completed their exchange.`,
          details: `${pendingTradeProposal.targetCountry} gave ${settledTrade.finalDeductAmount} Coins in ${getTradeFieldLabel(pendingTradeProposal.requestedField)} and received ${settledTrade.finalAddAmount} Coins in ${getTradeFieldLabel(pendingTradeProposal.offeredField)}. ${pendingTradeProposal.proposerCountry} receives ${proposerReceipt} Coins in ${getTradeFieldLabel(pendingTradeProposal.requestedField)}.`
        });
      }
    } else {
      publishGameResult({
        icon: "❌",
        category: "TRADE RESULT",
        tone: "danger",
        title: "Trade Rejected",
        summary: `${pendingTradeProposal.targetCountry} declined the trade from ${pendingTradeProposal.proposerCountry}.`,
        details: "The proposer’s reserved offer has been returned."
      });
      if (gameBroadcast) {
        gameBroadcast.postMessage({
          type: "REJECT_TRADE",
          payload: { proposalId: pendingTradeProposal.id }
        });
      }
      logAction(`❌ You rejected the trade proposal from ${pendingTradeProposal.proposerCountry}.`, "TRADE");
    }
    pendingTradeProposal = null;
  } else if (pendingAllianceProposal) {
    respondToAllianceProposal(approved);
  }

  updateAllianceUI();
};

// ==========================================
// HOST CONTROLS
// ==========================================
window.hostDealCards = async function() {
  if (!requireRoomCreator("deal cards")) return;
  if (cardsDealtThisRound) return;
  await submitHostCommand("HOST_DEAL_CARDS");
};

window.drawGlobalCondition = async function() {
  if (!requireRoomCreator("draw the Global Event")) return;
  if (!cardsDealtThisRound || eventDrawnThisRound) return;
  const seatedPlayers = activeRoomPlayers.length || registeredPlayersCount;
  if (!seatedPlayers || lockedPlayersSet.size < seatedPlayers) {
    logAction("⚠️ Every seated player must lock investments before the Global Condition is drawn.", "EVENT");
    return;
  }

  await submitHostCommand("HOST_DRAW_EVENT", {});
};

// ==========================================
// COIN PURCHASE REQUEST ENGINE
// ==========================================
window.requestBuyCoins = async function() {
  if (coinRequestsUsed >= MAX_COIN_REQUESTS) {
    logAction(
      `🛑 Request limit reached: you can make up to ${MAX_COIN_REQUESTS} coin purchase requests per game.`,
      "BANK"
    );
    return;
  }

  const reservedCoins = getPendingCoinPurchaseAmount();
  if (coins + reservedCoins + 100 > MAX_PURCHASE_CAP) {
    logAction(
      `🛑 Purchase Capped: Approved coins and pending requests cannot exceed ${MAX_PURCHASE_CAP} coins.`,
      "BANK"
    );
    return;
  }

  const submitted = await submitRoomEvent("REQUEST_COINS", {});
  if (!submitted) return;

  logAction(`⏳ Coin Purchase Request submitted! Waiting for Host Approval (+100 Coins)...`, "BANK");
};

function getPendingCoinPurchaseAmount() {
  if (!assignedCountry) return 0;
  return pendingCoinRequests.reduce((total, request) => (
    cleanStr(request.country) === cleanStr(assignedCountry.name)
      ? total + (Number(request.amount) || 0)
      : total
  ), 0);
}

function syncCoinPurchaseControl() {
  const button = document.getElementById("btn-buy-coins");
  if (!button) return;

  const reservedCoins = getPendingCoinPurchaseAmount();
  const capped = coins + reservedCoins + 100 > MAX_PURCHASE_CAP;
  const requestLimitReached = coinRequestsUsed >= MAX_COIN_REQUESTS;
  button.disabled = capped || requestLimitReached || gameFinished;
  button.title = requestLimitReached
    ? `You have reached the ${MAX_COIN_REQUESTS}-request limit for this game.`
    : capped
      ? `Approved coins plus pending purchase requests cannot exceed ${MAX_PURCHASE_CAP} coins.`
      : "Request 100 coins from the host.";

  setTxt("status-coin-requests", `${coinRequestsUsed} / ${MAX_COIN_REQUESTS}`);
  const copy = translations[currentLang] || translations.en;
  setTxt(
    "status-coin-requests-help",
    (copy.txtCoinRequestsUsed || "{used} / {limit} used this game")
      .replace("{used}", coinRequestsUsed)
      .replace("{limit}", MAX_COIN_REQUESTS)
  );
}

function renderHostCoinRequests() {
  const container = document.getElementById("host-requests-container");
  if (!container) return;

  container.replaceChildren();

  if (pendingCoinRequests.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.style.color = "var(--text-muted)";
    emptyP.style.fontSize = "0.9rem";
    emptyP.textContent = "No pending coin purchase requests.";
    container.appendChild(emptyP);
    return;
  }

  pendingCoinRequests.forEach((req, idx) => {
    const item = document.createElement("div");
    item.className = "request-item";

    const label = document.createElement("span");
    label.innerHTML = `<strong>${req.country}</strong> requests <strong>+${req.amount} Coins</strong>`;

    const btnGroup = document.createElement("div");
    btnGroup.className = "button-group";

    const approveBtn = document.createElement("button");
    approveBtn.className = "btn btn-small btn-success";
    approveBtn.textContent = "✅ Approve";
    approveBtn.onclick = () => resolveCoinRequest(req.requestId, true);

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "btn btn-small btn-danger";
    rejectBtn.textContent = "❌ Reject";
    rejectBtn.onclick = () => resolveCoinRequest(req.requestId, false);

    btnGroup.appendChild(approveBtn);
    btnGroup.appendChild(rejectBtn);

    item.appendChild(label);
    item.appendChild(btnGroup);
    container.appendChild(item);
  });
}

async function resolveCoinRequest(requestId, approved) {
  if (!requireRoomCreator("resolve coin requests")) return;
  const req = pendingCoinRequests.find(item => item.requestId === requestId);
  if (!req) return;

  await submitHostCommand("RESOLVE_COIN_REQUEST", {
    requestId,
    approved: approved
  });
}

function updateUI() {
  setTxt("total-budget", coins);
  setTxt("merchant-status", isMerchantActive ? "Yes (+10%) ✅" : "No ❌");
  updateLoanCalculator();
  renderRoundSettlement();
  syncCoinPurchaseControl();

  // Read state to text fields and calculate unallocated without overwriting sliders yet
  let totalAllocated = investments.agri + investments.oil + investments.mines;
  setTxt("unallocated-coins", Math.max(0, coins - totalAllocated));

  ["agri", "oil", "mines"].forEach(field => {
    const slider = document.getElementById(`slider-${field}`);
    if (slider) {
      slider.max = coins.toString();
      // Ensure slider visually reflects state (critical for trade/skirmish wipes)
      slider.value = investments[field];
    }
    setTxt(`val-${field}`, investments[field]);
  });
  syncInvestmentStepperControls(totalAllocated);
  renderInvestmentVisuals();

  updateOfferSliderCapacity();
  updateAllianceUI();
  syncFieldBattleLoanGate();
  renderCommandBoard();
  updateResourceSelectorLabels();
  syncCommanderStatus(totalAllocated);
}

function syncCommanderStatus(totalAllocated = investments.agri + investments.oil + investments.mines) {
  const strip = document.getElementById("commander-status-strip");
  if (!strip) return;

  const copy = translations[currentLang] || translations.en;
  const unallocated = Math.max(0, coins - totalAllocated);
  const loanDue = bankerRepaymentDue();
  const tradesRemaining = Math.max(0, fieldTradeAttemptLimit - fieldTradeAttemptsUsed);
  const battlesRemaining = Math.max(0, skirmishMaxAllowedAttacks - skirmishAttacksExecuted);

  let phase = "prepare";
  let nextAction = copy.txtStatusLock;
  if (gameFinished) {
    phase = "review";
    nextAction = copy.txtStatusComplete;
  } else if (investmentsLocked && isLocalPlayerReadyToClose) {
    phase = "review";
    nextAction = copy.txtStatusWaiting;
  } else if (isActPhaseReady()) {
    phase = "act";
    nextAction = copy.txtStatusAct;
  } else if (investmentsLocked) {
    nextAction = copy.txtStatusPrepareWait;
  } else if (loanDue > 0 && unallocated >= loanDue) {
    nextAction = copy.btnRepayLoan;
  }

  setTxt("status-round-label", `${copy.txtStatusRound} ${currentRound}`);
  setTxt("status-country", assignedCountry?.name || "—");
  setTxt("status-coins", coins);
  setTxt("status-unallocated", unallocated);
  setTxt("status-loan", loanDue > 0 ? loanDue : copy.txtStatusClear);
  setTxt("status-trades", tradesRemaining);
  setTxt("status-battles", battlesRemaining);
  setTxt("status-next-action", nextAction);

  strip.dataset.phase = phase;
  strip.classList.toggle("has-loan", loanDue > 0);
  strip.classList.toggle("is-ready", isLocalPlayerReadyToClose);

  if (!gameTabsInitialized) initializeGameTabs();
  if (lastAutoGamePhase !== null && lastAutoGamePhase !== phase) {
    selectGameTab(phase);
  }
  lastAutoGamePhase = phase;
  document.querySelectorAll(".game-tab").forEach(tab => {
    tab.classList.toggle("is-current-phase", tab.dataset.gameTab === phase);
  });
  syncGameTabBadges(phase);
}

function bankerRepaymentDue(principal = loans, persistedInterest = loanInterest) {
  const safePrincipal = Math.max(0, Number(principal) || 0);
  const safeInterest = Math.max(0, Number(persistedInterest) || 0);
  return safePrincipal + safeInterest;
}

function bankerLoanAmount(availableCoins) {
  return Math.floor(Math.max(0, Number(availableCoins) || 0) * 0.20);
}

function updateLoanCalculator() {
  const copy = translations[currentLang] || translations.en;
  const principal = Math.max(0, Number(loans) || 0);
  const interest = Math.max(0, Number(loanInterest) || 0);
  const totalDue = bankerRepaymentDue(principal, interest);
  const availableCash = coins;
  const shortfall = Math.max(0, totalDue - availableCash);
  const canRepay = totalDue > 0 && shortfall === 0 && !gameFinished;

  setTxt("loan-principal", principal);
  setTxt("loan-interest", interest);
  setTxt("loan-total", totalDue);
  setTxt("loan-wallet", availableCash);
  setTxt("loan-shortfall", shortfall);
  document.querySelector(".loan-shortfall-row")?.classList.toggle("has-shortfall", shortfall > 0);

  const repayButton = document.getElementById("btn-repay-loan");
  if (repayButton) {
    repayButton.textContent = copy.btnRepayLoan;
    repayButton.disabled = !canRepay;
    repayButton.title = totalDue <= 0
      ? copy.txtLoanNoDebt
      : shortfall > 0
        ? copy.txtLoanInsufficient.replace("{shortfall}", shortfall)
        : copy.txtLoanReady;
  }

  const message = document.getElementById("loan-settlement-message");
  if (message) {
    message.classList.toggle("is-ready", canRepay);
    message.textContent = totalDue <= 0
      ? copy.txtLoanNoDebt
      : shortfall > 0
        ? copy.txtLoanInsufficient.replace("{shortfall}", shortfall)
        : copy.txtLoanReady;
  }

  const battleGate = document.getElementById("field-battle-loan-gate");
  if (battleGate) {
    const battleLocked = totalDue > 0;
    battleGate.classList.toggle("is-blocked", battleLocked);
    battleGate.classList.toggle("is-ready", !battleLocked);
    battleGate.textContent = battleLocked ? copy.txtBattleLoanGate : copy.txtBattleReady;
  }
}

function renderRoundSettlement() {
  const card = document.getElementById("round-settlement-card");
  const method = document.getElementById("round-settlement-method");
  const details = document.getElementById("round-settlement-details");
  if (!card || !method || !details) return;

  const settlement = lastRoundSettlement;
  if (!settlement?.fieldYields) {
    card.classList.add("hidden");
    method.textContent = "";
    details.replaceChildren();
    return;
  }

  const copy = translations[currentLang] || translations.en;
  const source = settlement.source || {};
  const isAlliance = source.type === "alliance";
  method.textContent = isAlliance
    ? `${copy.txtSettlementAlliance}: ${source.allianceType || "Alliance"} · ${source.memberCount || 1} members`
    : copy.txtSettlementSolo;
  details.replaceChildren();

  const fieldLabels = {
    agri: copy.lblMultAgri,
    oil: copy.lblMultOil,
    mines: copy.lblMultMines
  };
  ["agri", "oil", "mines"].forEach(field => {
    const yieldData = settlement.fieldYields[field] || {};
    const row = document.createElement("p");
    const basisLabel = yieldData.isAlliancePool ? "pool" : "locked";
    row.textContent = `${fieldLabels[field]}: ${basisLabel} ${Number(yieldData.basis) || 0} × ${Number(yieldData.multiplier) || 0} = +${Number(yieldData.income) || 0}`;
    details.appendChild(row);
  });

  const opening = document.createElement("p");
  opening.textContent = `Unallocated cash before field income: ${Number(settlement.balanceBefore) || 0}`;
  details.appendChild(opening);

  const gross = document.createElement("p");
  gross.className = "round-settlement-total";
  gross.textContent = `${copy.txtSettlementGross}: +${Number(settlement.grossFieldIncome) || 0}`;
  details.appendChild(gross);

  const loan = settlement.loan || {};
  const loanDue = Number(loan.repaymentDue) || 0;
  const loanCollected = Number(loan.collected) || 0;
  if (loanDue > 0 || loanCollected > 0) {
    const loanRow = document.createElement("p");
    loanRow.textContent = `${copy.txtSettlementLoan}: -${loanCollected} / ${loanDue}`;
    details.appendChild(loanRow);
  }

  const balance = document.createElement("p");
  balance.className = "round-settlement-total";
  const reconciliation = (Number(settlement.balanceBefore) || 0)
    + (Number(settlement.grossFieldIncome) || 0)
    - loanCollected;
  balance.textContent = `${copy.txtSettlementBalance}: ${Number(settlement.endingBalance) || 0} (${Number(settlement.balanceBefore) || 0} + ${Number(settlement.grossFieldIncome) || 0} − ${loanCollected} = ${reconciliation})`;
  details.appendChild(balance);
  card.classList.remove("hidden");
}

function syncFieldBattleLoanGate() {
  const copy = translations[currentLang] || translations.en;
  const blocked = bankerRepaymentDue() > 0;
  const actLocked = !isActPhaseReady();
  ["btn-execute-skirmish", "btn-execute-alliance-skirmish"].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = blocked || actLocked;
    button.title = actLocked ? actActionLockMessage() : blocked ? copy.txtBattleLoanGate : "";
  });
}

window.repayBankerLoan = async function() {
  const repaymentDue = bankerRepaymentDue();
  if (repaymentDue <= 0) {
    logAction("⚠️ You do not have an active Banker loan to repay.", "BANK");
    return;
  }
  const availableCash = coins;
  if (availableCash < repaymentDue) {
    const shortfall = repaymentDue - availableCash;
    logAction(`⚠️ Loan repayment requires ${repaymentDue} total wallet coins; you need ${shortfall} more.`, "BANK");
    return;
  }
  const repaid = await submitRoomEvent("REPAY_BANKER_LOAN", {});
  if (repaid) playSound("ui");
};

function renderInvestmentVisuals() {
  ["agri", "oil", "mines"].forEach(field => {
    const slider = document.getElementById(`slider-${field}`);
    const fieldBox = slider?.closest(".resource-field");
    if (!slider || !fieldBox) return;
    const maximum = Math.max(1, Number(slider.max) || coins || 1);
    const progress = Math.min(100, Math.max(0, Number(investments[field]) / maximum * 100));
    slider.style.setProperty("--range-progress", `${progress}%`);
    fieldBox.classList.toggle("is-allocated", Number(investments[field]) > 0);
    fieldBox.classList.toggle("is-locked", investmentsLocked);
  });
  const card = document.querySelector(".investment-card");
  card?.classList.toggle("is-locked", investmentsLocked);
}

window.onSliderChange = function(changedField) {
  if (investmentsLocked) return;

  let agriVal = parseInt(document.getElementById("slider-agri")?.value, 10) || 0;
  let oilVal = parseInt(document.getElementById("slider-oil")?.value, 10) || 0;
  let minesVal = parseInt(document.getElementById("slider-mines")?.value, 10) || 0;

  let totalAllocated = agriVal + oilVal + minesVal;

  if (totalAllocated > coins) {
    let overflow = totalAllocated - coins;
    if (changedField === 'agri') agriVal -= overflow;
    if (changedField === 'oil') oilVal -= overflow;
    if (changedField === 'mines') minesVal -= overflow;

    if (changedField === 'agri') document.getElementById('slider-agri').value = agriVal;
    if (changedField === 'oil') document.getElementById('slider-oil').value = oilVal;
    if (changedField === 'mines') document.getElementById('slider-mines').value = minesVal;

    totalAllocated = coins;
  }

  investments.agri = agriVal;
  investments.oil = oilVal;
  investments.mines = minesVal;

  setTxt("val-agri", agriVal);
  setTxt("val-oil", oilVal);
  setTxt("val-mines", minesVal);
  setTxt("unallocated-coins", coins - totalAllocated);
  syncInvestmentStepperControls(totalAllocated);
  renderInvestmentVisuals();
  pulseVisual(document.getElementById(`slider-${changedField}`)?.closest(".resource-field"), "is-adjusted", 230);
  playSound("tick", { cooldown: 110 });
};

function syncInvestmentStepperControls(totalAllocated = investments.agri + investments.oil + investments.mines) {
  ["agri", "oil", "mines"].forEach(field => {
    const decrease = document.querySelector(`.investment-stepper-button[data-field="${field}"][data-direction="decrease"]`);
    const increase = document.querySelector(`.investment-stepper-button[data-field="${field}"][data-direction="increase"]`);
    if (decrease) decrease.disabled = investmentsLocked || investments[field] <= 0;
    if (increase) increase.disabled = investmentsLocked || totalAllocated >= coins;
  });
}

window.adjustInvestment = function(field, amount) {
  if (
    investmentsLocked ||
    !["agri", "oil", "mines"].includes(field) ||
    ![-1, 1].includes(amount)
  ) return;
  const slider = document.getElementById(`slider-${field}`);
  if (!slider) return;

  slider.value = Math.max(0, Math.min(coins, (Number(slider.value) || 0) + amount));
  window.onSliderChange(field);
};

window.confirmInvestments = async function() {
  if (investmentsLocked) return;
  const locked = await submitRoomEvent("LOCK_RESOURCES", {
    agri: investments.agri,
    oil: investments.oil,
    mines: investments.mines
  });
  if (!locked) return;
  investmentsLocked = true;

  ["slider-agri", "slider-oil", "slider-mines"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });

  const lockBtn = document.getElementById("btn-lock-invest");
  if (lockBtn) {
    lockBtn.disabled = true;
    lockBtn.textContent = "🔒 Investments Locked";
  }

  const myCountry = assignedCountry ? assignedCountry.name : "Player";
  lockedPlayersSet.add(cleanStr(myCountry));
  updateUI();
  updateReadyConsensusUI();
  logAction(`✅ Locked field investments: Agri(${investments.agri}), Oil(${investments.oil}), Mines(${investments.mines}).`, "INVEST");
  pulseVisual(document.querySelector(".investment-card"), "is-confirmed", 620);
};

// ==========================================
// SKIRMISH BATTLE ENGINE
// ==========================================
window.openSkirmishModal = function() {
  if (!requireActPhase()) return;
  if (bankerRepaymentDue() > 0) {
    logAction("⚠️ Settle your Banker loan and interest in Player Overview before opening a Field Battle.", "SKIRMISH");
    return;
  }
  if (!investmentsLocked) {
    logAction("⚠️ Skirmish combat requires field investments to be locked first!", "SKIRMISH");
    return;
  }

  if (skirmishAttacksExecuted >= skirmishMaxAllowedAttacks) {
    logAction(`⚠️ Attack Limit Reached: You have used all (${skirmishMaxAllowedAttacks}) skirmish attacks for this round.`, "SKIRMISH");
    return;
  }

  const selectCountry = document.getElementById("select-skirmish-target-country");
  if (selectCountry) {
    selectCountry.innerHTML = "";
    liveCountryNames(true).forEach(country => {
      const opt = document.createElement("option");
      opt.value = country;
      opt.textContent = country;
      selectCountry.appendChild(opt);
    });
    if (!selectCountry.options.length) {
      logAction("⚠️ No other seated country is available to attack.", "SKIRMISH");
      return;
    }
  }

  updateResourceSelectorLabels();
  setTxt("val-attacks-left", skirmishMaxAllowedAttacks - skirmishAttacksExecuted);
  document.getElementById("skirmish-modal")?.classList.remove("hidden");
};

window.closeSkirmishModal = function() {
  document.getElementById("skirmish-modal")?.classList.add("hidden");
};

window.executeSkirmishAttack = async function() {
  if (!requireActPhase()) return;
  if (bankerRepaymentDue() > 0) {
    logAction("⚠️ Settle your Banker loan and interest before launching a Field Battle.", "SKIRMISH");
    return;
  }
  const targetCountryName = document.getElementById("select-skirmish-target-country")?.value;
  const targetField = document.getElementById("select-skirmish-target-field")?.value;

  if (!targetCountryName || !targetField) {
    logAction("⚠️ Select a valid enemy power and battleground field.", "SKIRMISH");
    return;
  }

  const completed = await submitRoomEvent("SOLO_SKIRMISH", {
    targetId: targetCountryName,
    field: targetField
  });
  if (completed) closeSkirmishModal();
};

// ==========================================
// ALLIANCE MUTUAL APPROVAL SYSTEM
// ==========================================
window.openPresidentModal = function(cardIndex) {
  if (isSimpleEdition()) {
    logAction("Mega-Merger is unavailable in the Simple Edition.", "ALLIANCE");
    return;
  }
  if (!investmentsLocked) {
    logAction("⚠️ President card requires field investments to be locked first!", "ALLIANCE");
    return;
  }

  const select1 = document.getElementById("select-pres-partner-1");
  const select2 = document.getElementById("select-pres-partner-2");
  if (!select1 || !select2) return;

  select1.innerHTML = "";
  select2.innerHTML = '<option value="">-- None (Optional) --</option>';

  liveCountryNames(true).forEach(country => {
    const opt1 = document.createElement("option");
    opt1.value = country;
    opt1.textContent = country;
    select1.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = country;
    opt2.textContent = country;
    select2.appendChild(opt2);
  });
  if (!select1.options.length) {
    logAction("⚠️ No other seated country is available for a merger.", "ALLIANCE");
    return;
  }

  window.pendingCardIndex = cardIndex;
  document.getElementById("president-modal")?.classList.remove("hidden");
};

window.confirmPresidentMergerProposal = function() {
  const partner1 = document.getElementById("select-pres-partner-1")?.value;
  const partner2 = document.getElementById("select-pres-partner-2")?.value;

  if (!partner1) {
    logAction("⚠️ Select at least 1 partner power for the President merger.", "ALLIANCE");
    return;
  }

  const myName = assignedCountry ? assignedCountry.name : "Primary Power";
  const members = [myName, partner1];
  if (partner2) members.push(partner2);

  const proposal = {
    proposalId: createGameResultId(),
    initiator: myName,
    allianceType: "Mega-Merger",
    members: members,
    approvals: [myName],
    pendingTargets: [partner1, ...(partner2 ? [partner2] : [])],
    data: {
      type: "Mega-Merger",
      members: members,
      totalAgri: Math.max(150, investments.agri * members.length + 150),
      totalOil: Math.max(150, investments.oil * members.length + 150),
      totalMines: Math.max(150, investments.mines * members.length + 150)
    }
  };

  pendingAllianceProposal = proposal;

  void submitRoomEvent("PROPOSE_ALLIANCE", proposal);

  if (typeof window.pendingCardIndex === "number") {
    currentHand.splice(window.pendingCardIndex, 1);
    renderHand();
  }

  closePresidentModal();
  updateAllianceUI();
  logAction(`🏛️ Sent President Mega-Merger proposal to ${proposal.pendingTargets.join(", ")}. Waiting for approval...`, "ALLIANCE");
};

window.closePresidentModal = function() {
  document.getElementById("president-modal")?.classList.add("hidden");
};

window.openCounterUnionModal = function() {
  if (isSimpleEdition()) {
    logAction("Counter-Union is unavailable in the Simple Edition.", "ALLIANCE");
    return;
  }
  const select1 = document.getElementById("select-union-partner-1");
  const select2 = document.getElementById("select-union-partner-2");
  if (!select1 || !select2) return;

  select1.innerHTML = "";
  select2.innerHTML = '<option value="">-- None (Optional) --</option>';

  const mergedMembers = activePresidentCoalition ? activePresidentCoalition.members.map(m => cleanStr(m)) : [];

  liveCountryNames().forEach(country => {
    const isSelf = assignedCountry && cleanStr(country) === cleanStr(assignedCountry.name);
    const isMerged = mergedMembers.includes(cleanStr(country));

    if (!isSelf && !isMerged) {
      const opt1 = document.createElement("option");
      opt1.value = country;
      opt1.textContent = country;
      select1.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = country;
      opt2.textContent = country;
      select2.appendChild(opt2);
    }
  });

  document.getElementById("counter-union-modal")?.classList.remove("hidden");
};

window.confirmCounterUnion = function() {
  const partner1 = document.getElementById("select-union-partner-1")?.value;
  const partner2 = document.getElementById("select-union-partner-2")?.value;

  if (!partner1) {
    logAction("⚠️ Select at least 1 ally to form the Counter-Union.", "ALLIANCE");
    return;
  }

  const myName = assignedCountry ? assignedCountry.name : "Defending Power";
  const unionMembers = [myName, partner1];
  if (partner2) unionMembers.push(partner2);

  const proposal = {
    proposalId: createGameResultId(),
    initiator: myName,
    allianceType: "Counter-Union",
    members: unionMembers,
    approvals: [myName],
    pendingTargets: [partner1, ...(partner2 ? [partner2] : [])],
    data: {
      type: "Counter-Union",
      members: unionMembers,
      totalAgri: Math.max(150, investments.agri * unionMembers.length + 150),
      totalOil: Math.max(150, investments.oil * unionMembers.length + 150),
      totalMines: Math.max(150, investments.mines * unionMembers.length + 150)
    }
  };

  pendingAllianceProposal = proposal;

  void submitRoomEvent("PROPOSE_ALLIANCE", proposal);

  document.getElementById("counter-union-modal")?.classList.add("hidden");
  updateAllianceUI();
  logAction(`🛡️ Sent Defensive Counter-Union proposal to ${proposal.pendingTargets.join(", ")}. Waiting for approval...`, "ALLIANCE");
};

function recordAllianceApproval(proposal, approvedBy) {
  if (!proposal || !approvedBy) return;

  if (!proposal.approvals.some(member => cleanStr(member) === cleanStr(approvedBy))) {
    proposal.approvals.push(approvedBy);
  }

  proposal.pendingTargets = proposal.pendingTargets.filter(
    member => cleanStr(member) !== cleanStr(approvedBy)
  );
}

async function finalizeAllianceProposal(proposal) {
  if (!proposal || proposal.pendingTargets.length > 0) return;

  const finalized = await submitRoomEvent("CONFIRM_ALLIANCE", proposal);
  if (!finalized) return;

  logAction(`🤝 ALLIANCE MUTUALLY APPROVED! Active powers: ${proposal.members.join(", ")}.`, "ALLIANCE");
  const isMegaMerger = proposal.allianceType === "Mega-Merger";
  publishGameResult({
    icon: isMegaMerger ? "🏛️" : "🛡️",
    category: isMegaMerger ? "PRESIDENT MERGER RESULT" : "UNION MERGER RESULT",
    tone: "success",
    title: isMegaMerger ? "President Mega-Merger Formed" : "Counter-Union Formed",
    summary: `${proposal.members.join(", ")} have formed an alliance.`,
    details: `Shared resources: 🌾 ${proposal.data.totalAgri} · 🛢️ ${proposal.data.totalOil} · ⛏️ ${proposal.data.totalMines}.`
  });
}

async function respondToAllianceProposal(approved) {
  const myName = assignedCountry ? assignedCountry.name : "";
  const proposal = pendingAllianceProposal;

  if (!proposal) return;

  if (approved) {
    const accepted = await submitRoomEvent("APPROVE_ALLIANCE", {
      proposalId: proposal.proposalId,
      approvedBy: myName
    });
    if (accepted) {
      logAction(`✅ You accepted the ${proposal.allianceType}. Awaiting final confirmation from the proposal initiator...`, "ALLIANCE");
    }
  } else {
    const isMegaMerger = proposal.allianceType === "Mega-Merger";
    const rejected = await submitRoomEvent("REJECT_ALLIANCE", {
      proposalId: proposal.proposalId,
      rejectedBy: myName
    });
    if (rejected) {
      publishGameResult({
        icon: "❌",
        category: isMegaMerger ? "PRESIDENT MERGER RESULT" : "UNION MERGER RESULT",
        tone: "danger",
        title: isMegaMerger ? "President Merger Rejected" : "Counter-Union Rejected",
        summary: `${myName || "A member"} rejected the proposed ${proposal.allianceType}.`,
        details: "The alliance proposal has been cancelled for all invited powers."
      });
      logAction(`❌ You REJECTED the ${proposal.allianceType} proposal!`, "ALLIANCE");
    }
  }
}

function updateAllianceUI() {
  const myCountryClean = assignedCountry ? cleanStr(assignedCountry.name) : "";

  const coalitionPanel = document.getElementById("coalition-panel");
  const unionBanner = document.getElementById("counter-union-banner");
  const proposalBanner = document.getElementById("pending-proposal-banner");
  const allianceAttackButton = document.getElementById("btn-alliance-skirmish");

  if (coalitionPanel) coalitionPanel.style.display = "none";
  if (unionBanner) {
    unionBanner.style.display = "none";
    unionBanner.classList.add("hidden");
  }
  if (proposalBanner) {
    proposalBanner.style.display = "none";
    proposalBanner.classList.add("hidden");
  }
  if (allianceAttackButton) allianceAttackButton.style.display = "none";

  if (pendingTradeProposal && cleanStr(pendingTradeProposal.targetCountry) === myCountryClean) {
    if (proposalBanner) {
      const wasHidden = proposalBanner.classList.contains("hidden");
      proposalBanner.classList.remove("hidden");
      proposalBanner.style.display = "block";
      if (wasHidden) {
        proposalBanner.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    setTxt("txt-proposal-title", `🤝 Trade Proposal Received`);
    const targetSettlement = calculateTradeSettlement(
      pendingTradeProposal.requestedAmount,
      pendingTradeProposal.offeredAmount
    );
    const proposerReceipt = calculateTradeSettlement(
      0,
      pendingTradeProposal.requestedAmount
    ).finalAddAmount;
    setTxt(
      "txt-proposal-desc",
      `${pendingTradeProposal.proposerCountry} offers ${pendingTradeProposal.offeredAmount} Coins (${getTradeFieldLabel(pendingTradeProposal.offeredField)}) in exchange for ${pendingTradeProposal.requestedAmount} Coins (${getTradeFieldLabel(pendingTradeProposal.requestedField)}). After active conditions: you provide ${targetSettlement.finalDeductAmount} Coins and receive ${targetSettlement.finalAddAmount} Coins; ${pendingTradeProposal.proposerCountry} receives ${proposerReceipt} Coins.`
    );
  } else if (pendingAllianceProposal) {
    const isTarget = pendingAllianceProposal.pendingTargets.some(m => cleanStr(m) === myCountryClean);

    if (isTarget) {
      if (proposalBanner) {
        const wasHidden = proposalBanner.classList.contains("hidden");
        proposalBanner.classList.remove("hidden");
        proposalBanner.style.display = "block";
        if (wasHidden) {
          proposalBanner.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      setTxt("txt-proposal-title", `📜 ${pendingAllianceProposal.allianceType} Invitation`);
      setTxt("txt-proposal-desc", `${pendingAllianceProposal.initiator} wants to form a ${pendingAllianceProposal.allianceType} with you! Members: ${pendingAllianceProposal.members.join(", ")}`);
    }
  }

  if (activePresidentCoalition && Array.isArray(activePresidentCoalition.members)) {
    const isMember = activePresidentCoalition.members.some(m => cleanStr(m) === myCountryClean);

    if (isMember) {
      if (coalitionPanel) coalitionPanel.style.display = "block";
      setTxt("coalition-title", "🏛️ President Mega-Merger Pool");
      const pool = activePresidentCoalition.pool || {
        agri: activePresidentCoalition.totalAgri,
        oil: activePresidentCoalition.totalOil,
        mines: activePresidentCoalition.totalMines
      };
      setTxt("pool-agri", `${pool.agri} Coins`);
      setTxt("pool-oil", `${pool.oil} Coins`);
      setTxt("pool-mines", `${pool.mines} Coins`);
      setTxt("coalition-members-list", `Members: ${activePresidentCoalition.members.join(", ")}`);
      if (allianceAttackButton && cleanStr(activePresidentCoalition.initiator) === myCountryClean) {
        allianceAttackButton.style.display = "inline-flex";
        const actLocked = !isActPhaseReady();
        allianceAttackButton.disabled = actLocked || Boolean(activePresidentCoalition.attacksUsed) || bankerRepaymentDue() > 0;
        allianceAttackButton.textContent = bankerRepaymentDue() > 0
          ? (translations[currentLang] || translations.en).txtBoardBattleLoanLocked
          : activePresidentCoalition.attacksUsed
          ? "✓ Alliance Skirmish Used"
          : "⚔️ Alliance Skirmish";
        allianceAttackButton.title = actLocked
          ? actActionLockMessage()
          : bankerRepaymentDue() > 0
          ? (translations[currentLang] || translations.en).txtBattleLoanGate
          : "";
      }
    } else if (!activeCounterUnion) {
      if (unionBanner) {
        unionBanner.classList.remove("hidden");
        unionBanner.style.display = "block";
      }
    }
  }

  if (activeCounterUnion && Array.isArray(activeCounterUnion.members)) {
    if (unionBanner) {
      unionBanner.style.display = "none";
      unionBanner.classList.add("hidden");
    }

    const isDefender = activeCounterUnion.members.some(m => cleanStr(m) === myCountryClean);

    if (isDefender) {
      if (coalitionPanel) coalitionPanel.style.display = "block";
      setTxt("coalition-title", "🛡️ Counter-Union Defensive Pool");
      const pool = activeCounterUnion.pool || {
        agri: activeCounterUnion.totalAgri,
        oil: activeCounterUnion.totalOil,
        mines: activeCounterUnion.totalMines
      };
      setTxt("pool-agri", `${pool.agri} Coins`);
      setTxt("pool-oil", `${pool.oil} Coins`);
      setTxt("pool-mines", `${pool.mines} Coins`);
      setTxt("coalition-members-list", `Defenders: ${activeCounterUnion.members.join(", ")}`);
      if (allianceAttackButton && cleanStr(activeCounterUnion.initiator) === myCountryClean) {
        allianceAttackButton.style.display = "inline-flex";
        const actLocked = !isActPhaseReady();
        allianceAttackButton.disabled = actLocked || Boolean(activeCounterUnion.attacksUsed) || bankerRepaymentDue() > 0;
        allianceAttackButton.textContent = bankerRepaymentDue() > 0
          ? (translations[currentLang] || translations.en).txtBoardBattleLoanLocked
          : activeCounterUnion.attacksUsed
          ? "✓ Alliance Skirmish Used"
          : "⚔️ Alliance Skirmish";
        allianceAttackButton.title = actLocked
          ? actActionLockMessage()
          : bankerRepaymentDue() > 0
          ? (translations[currentLang] || translations.en).txtBattleLoanGate
          : "";
      }
    }
  }

  syncGameTabBadges(lastAutoGamePhase || "prepare");
}

function currentInitiatedAlliance() {
  const myCountry = assignedCountry ? cleanStr(assignedCountry.name) : "";
  return [activePresidentCoalition, activeCounterUnion].find(
    alliance => alliance && cleanStr(alliance.initiator) === myCountry
  ) || null;
}

window.openAllianceSkirmishModal = function() {
  if (!requireActPhase()) return;
  if (bankerRepaymentDue() > 0) {
    logAction("⚠️ Settle your Banker loan and interest in Player Overview before launching an alliance Field Battle.", "ALLIANCE");
    return;
  }
  const alliance = currentInitiatedAlliance();
  if (!alliance || alliance.attacksUsed) {
    logAction("⚠️ Only the alliance initiator may launch one coalition skirmish this round.", "ALLIANCE");
    return;
  }
  const select = document.getElementById("select-alliance-skirmish-target");
  if (!select) return;
  const members = new Set((alliance.members || []).map(cleanStr));
  allianceCombatTargets = [];
  lockedPlayersSet.forEach(countryKey => {
    const country = countryCards.find(card => cleanStr(card.name) === countryKey)?.name;
    if (country && !members.has(countryKey)) {
      allianceCombatTargets.push({ kind: "solo", id: country, label: `Solo country — ${country}` });
    }
  });
  [activePresidentCoalition, activeCounterUnion].forEach(other => {
    if (other?.proposalId && other.proposalId !== alliance.proposalId) {
      allianceCombatTargets.push({
        kind: "alliance",
        id: other.proposalId,
        label: `${other.allianceType || "Alliance"} — ${(other.members || []).join(", ")}`
      });
    }
  });
  select.innerHTML = "";
  allianceCombatTargets.forEach(target => {
    const option = document.createElement("option");
    option.value = `${target.kind}:${target.id}`;
    option.textContent = target.label;
    select.appendChild(option);
  });
  if (!allianceCombatTargets.length) {
    logAction("⚠️ No valid locked solo country or opposing alliance is available to attack.", "ALLIANCE");
    return;
  }
  updateResourceSelectorLabels();
  document.getElementById("alliance-skirmish-modal")?.classList.remove("hidden");
};

window.closeAllianceSkirmishModal = function() {
  document.getElementById("alliance-skirmish-modal")?.classList.add("hidden");
};

window.executeAllianceSkirmish = async function() {
  if (!requireActPhase()) return;
  if (bankerRepaymentDue() > 0) {
    logAction("⚠️ Settle your Banker loan and interest before launching an alliance Field Battle.", "ALLIANCE");
    return;
  }
  const selected = document.getElementById("select-alliance-skirmish-target")?.value || "";
  const [targetKind, ...targetIdParts] = selected.split(":");
  const targetId = targetIdParts.join(":");
  const field = document.getElementById("select-alliance-skirmish-field")?.value;
  if (!targetKind || !targetId || !field) return;
  const completed = await submitRoomEvent("ALLIANCE_SKIRMISH", { field, targetKind, targetId });
  if (completed) closeAllianceSkirmishModal();
};

// ==========================================
// ADVANCE ROUND & HOST ROUND CLOSURE
// ==========================================
window.hostAdvanceRound = async function() {
  if (!requireRoomCreator("close the round")) return;
  if (gameFinished) {
    logAction("🏆 This three-round game is complete. Restart the room to begin a new game.", "ROUND");
    return;
  }
  const blockers = [];
  if (!cardsDealtThisRound) blockers.push("proficiency cards have not been dealt");
  if (!eventDrawnThisRound) blockers.push("the Global Condition card has not been dealt");
  if (lockedPlayersSet.size < registeredPlayersCount) {
    blockers.push(`only ${lockedPlayersSet.size}/${registeredPlayersCount} players have locked investments`);
  }
  if (readyPlayersSet.size < registeredPlayersCount) {
    blockers.push(`only ${readyPlayersSet.size}/${registeredPlayersCount} players are ready`);
  }

  if (blockers.length > 0) {
    logAction(`⛔ Round cannot advance yet: ${blockers.join("; ")}.`, "ROUND");
    return;
  }

  await submitHostCommand("EXECUTE_ROUND_CALCULATION");
};

window.restartCompletedGame = async function() {
  if (!requireRoomCreator("restart the game") || !gameFinished) return;
  await resetTableSeats("Restart the game? This clears all seats, balances, cards, and final placements so commanders can join a new game.");
};

window.resetTableSeats = async function(
  confirmationMessage = "Reset the table seats? This ends the current game and clears every commander, balance, card, and round for everyone."
) {
  if (!requireRoomCreator("reset the table")) return;
  if (!window.confirm(confirmationMessage)) {
    return;
  }
  try {
    const response = await fetch(editionApiPath("/api/room/reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ edition: activeEdition })
    });
    const data = await response.json();
    if (!response.ok) {
      logAction(`⛔ ${data.error || "The table could not be reset."}`, "HOST");
      return;
    }
    clearPlayerGameMemory();
    window.location.replace(`index.html?${editionQuery()}`);
  } catch (e) {
    logAction("⛔ Could not contact the game server to reset the table.", "HOST");
  }
};

function calculateAndAdvanceRound(canonicalResult = null, roundResult = {}) {
  if (pendingOutgoingTrade) {
    refundTradeEscrow(pendingOutgoingTrade);
    pendingOutgoingTrade = null;
    logAction("↩️ Unresolved trade offer returned before round calculation.", "TRADE");
  }

  let earnedAgriYield = 0;
  let earnedOilYield = 0;
  let earnedMinesYield = 0;
  const completedCondition = activeGlobalCondition ? { ...activeGlobalCondition } : null;
  let grossRoundProfit = 0;
  let balanceBeforeRound = coins;
  let loanRepaymentDue = 0;
  let loanRepaymentCollected = 0;
  let fieldYields = canonicalResult?.fieldYields || null;

  if (canonicalResult) {
    const settlement = canonicalResult.settlement || {};
    balanceBeforeRound = Number(settlement.balanceBefore);
    if (!Number.isFinite(balanceBeforeRound)) balanceBeforeRound = coins;
    earnedAgriYield = Number(fieldYields?.agri?.income) || 0;
    earnedOilYield = Number(fieldYields?.oil?.income) || 0;
    earnedMinesYield = Number(fieldYields?.mines?.income) || 0;
    grossRoundProfit = Number(canonicalResult.grossProfit) || (
      earnedAgriYield + earnedOilYield + earnedMinesYield
    );
    loanRepaymentDue = Number(settlement.loan?.repaymentDue) || 0;
    loanRepaymentCollected = Number(canonicalResult.repayment) || 0;
    coins = Number(canonicalResult.coins) || 0;
    loans = Number(canonicalResult.loans) || 0;
    loanInterest = Number(canonicalResult.loanInterest) || 0;
    lastRoundSettlement = fieldYields && settlement
      ? { ...settlement, fieldYields, round: Number(roundResult.round) || currentRound }
      : null;
  } else {
    // This fallback is only for an interrupted event stream. The server result is
    // always the source of truth when the normal round-close event arrives.
    balanceBeforeRound = Math.max(
      0,
      coins - (Number(investments.agri) || 0) - (Number(investments.oil) || 0) - (Number(investments.mines) || 0)
    );
    const activeAlliance = [activePresidentCoalition, activeCounterUnion].find(alliance =>
      alliance?.members?.some(member => cleanStr(member) === cleanStr(assignedCountry?.name || ""))
    ) || null;
    const fieldBasis = activeAlliance
      ? (activeAlliance.pool || {
          agri: activeAlliance.totalAgri,
          oil: activeAlliance.totalOil,
          mines: activeAlliance.totalMines
        })
      : investments;
    const memberCount = activeAlliance?.members?.length || 1;
    fieldYields = Object.fromEntries(["agri", "oil", "mines"].map(field => {
      const multiplier = getEffectiveResourceMultiplier(field);
      return [field, {
        basis: Number(fieldBasis[field]) || 0,
        multiplier,
        income: Math.floor((Number(fieldBasis[field]) || 0) * multiplier / memberCount),
        isAlliancePool: Boolean(activeAlliance)
      }];
    }));
    earnedAgriYield = fieldYields.agri.income;
    earnedOilYield = fieldYields.oil.income;
    earnedMinesYield = fieldYields.mines.income;
    grossRoundProfit = earnedAgriYield + earnedOilYield + earnedMinesYield;
    loanRepaymentDue = bankerRepaymentDue();
    loanRepaymentCollected = Math.min(
      Math.max(0, coins + grossRoundProfit),
      loanRepaymentDue
    );
    const interestCollected = Math.min(loanInterest, loanRepaymentCollected);
    const principalCollected = loanRepaymentCollected - interestCollected;
    loans = Math.max(0, loans - principalCollected);
    loanInterest = Math.max(0, loanInterest - interestCollected);
    coins = Math.max(0, coins + grossRoundProfit - loanRepaymentCollected);
    lastRoundSettlement = {
      source: activeAlliance
        ? { type: "alliance", allianceType: activeAlliance.allianceType, memberCount }
        : { type: "solo" },
      balanceBefore: balanceBeforeRound,
      grossFieldIncome: grossRoundProfit,
      loan: {
        repaymentDue: loanRepaymentDue,
        collected: loanRepaymentCollected,
        principalRemaining: loans,
        interestRemaining: loanInterest
      },
      endingBalance: coins,
      fieldYields,
      round: Number(roundResult.round) || currentRound
    };
  }
  const netBalanceChange = coins - balanceBeforeRound;

  gameFinished = Boolean(roundResult.gameFinished);
  finalPlacements = Array.isArray(roundResult.placements) ? roundResult.placements : [];
  const nextRound = Number(roundResult.nextRound);
  const completedRound = Number(roundResult.round);
  currentRound = gameFinished
    ? (Number.isInteger(completedRound) ? completedRound : 3)
    : (Number.isInteger(nextRound) ? nextRound : Math.min(currentRound + 1, 3));
  applyRoundResourceMultipliers(roundResult.resourceMultipliers);
  resetRoundAnnouncements();

  investmentsLocked = false;
  isMerchantActive = false;
  activePresidentCoalition = null;
  activeCounterUnion = null;
  pendingAllianceProposal = null;
  pendingTradeProposal = null;
  cardsDealtThisRound = Boolean(roundResult.cardsDealt);
  eventDrawnThisRound = false;
  clearActiveGlobalCondition();
  currentHand = [];
  renderHand();
  isLocalPlayerReadyToClose = false;
  readyPlayersSet.clear();
  lockedPlayersSet.clear();
  resetLocalSoloBattleAllowance();

  investments = { agri: 0, oil: 0, mines: 0 };
  ["slider-agri", "slider-oil", "slider-mines"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = gameFinished;
      el.value = "0";
    }
  });

  const lockBtn = document.getElementById("btn-lock-invest");
  if (lockBtn) {
    lockBtn.disabled = gameFinished;
    lockBtn.textContent = gameFinished ? "🏆 Game Complete" : "Lock In Investments";
  }

  const readyBtn = document.getElementById("btn-player-ready");
  if (readyBtn) {
    readyBtn.textContent = (translations[currentLang] || translations.en).btnReadyNextRound;
    readyBtn.className = "btn btn-success btn-large";
    readyBtn.disabled = gameFinished;
  }

  syncHostButtonsUI();
  updateReadyConsensusUI();
  updateAllianceUI();
  updateUI();
  updateCountryUI();
  renderTvRoster();
  updateTvRoundStatus();
  renderFinalPlacements();
  syncFinishedGameControls();

  const conditionSummary = completedCondition
    ? ` Global Condition resolved: ${completedCondition.title}.`
    : "";
  const netBalanceLabel = netBalanceChange >= 0 ? `+${netBalanceChange}` : `${netBalanceChange}`;
  const loanSummary = loanRepaymentDue > 0
    ? ` Loan Repayment: -${loanRepaymentCollected} of ${loanRepaymentDue}. Remaining Debt: ${bankerRepaymentDue()}.`
    : " Loan Repayment: -0.";
  const canonicalSummary = canonicalResult
    ? ` Server settlement: Gross +${canonicalResult.grossProfit} Coins.`
    : ` Gross +${grossRoundProfit} Coins (Agri:${earnedAgriYield}, Oil:${earnedOilYield}, Mines:${earnedMinesYield}).`;
  const roundMessage = gameFinished
    ? `🏆 Round 3 is complete. Final placements are available; choose the winner together at the table.${canonicalSummary}${loanSummary}`
    : `🎲 Round ${currentRound} is open with freshly randomized resource multipliers. Previous round result:${canonicalSummary}${loanSummary} Net balance change: ${netBalanceLabel} Coins.${conditionSummary} Deal cards and one Global Event are ready.`;
  logAction(roundMessage, "ROUND");
}

// ==========================================
// PROFICIENCY CARDS HAND (EDITION-SPECIFIC CARD COUNT)
// ==========================================
function renderHand() {
  const container = document.getElementById("cards-container");
  if (!container) return;

  container.replaceChildren();

  const displayCards = currentHand.slice(0, activeEdition === "simple" ? 1 : 2);
  const copy = translations[currentLang] || translations.en;

  displayCards.forEach((card, index) => {
    const element = document.createElement("div");
    const isAtomicDisabled = activeEdition !== "simple"
      && card.title === "Atomic Bomb"
      && isGlobalConditionActive("pandemic");
    const isGeneralDisabled = card.title === "General" && !isActPhaseReady();
    const isHitmanDisabled = card.title === "Hitman" && investmentsLocked;
    const isCardDisabled = isAtomicDisabled || isGeneralDisabled || isHitmanDisabled;
    const disabledMessage = isAtomicDisabled
      ? copy.txtAtomicDisabled
      : isGeneralDisabled
        ? copy.txtGeneralActOnly
        : copy.txtHitmanPrepareOnly;
    element.className = `prof-card${isCardDisabled ? " is-disabled" : ""}`;
    element.style.cursor = isCardDisabled ? "not-allowed" : "pointer";
    element.setAttribute("role", "button");
    element.setAttribute("aria-disabled", String(isCardDisabled));
    element.tabIndex = isCardDisabled ? -1 : 0;
    if (isCardDisabled) {
      element.title = disabledMessage;
    }

    element.onclick = () => {
      if (isCardDisabled) {
        logAction(disabledMessage, card.title === "Atomic Bomb" ? "EVENT" : "CARD");
        return;
      }
      playCardAction(card, index);
    };
    element.onkeydown = event => {
      if (!isCardDisabled && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        playCardAction(card, index);
      }
    };

    const iconDiv = document.createElement("div");
    iconDiv.className = "card-icon";
    iconDiv.textContent = card.icon;

    const titleDiv = document.createElement("div");
    titleDiv.className = "card-title";
    titleDiv.textContent = card.title;

    const descDiv = document.createElement("div");
    descDiv.className = "card-desc";
    descDiv.textContent = localizedCardDescription(card);

    element.appendChild(iconDiv);
    element.appendChild(titleDiv);
    element.appendChild(descDiv);
    container.appendChild(element);
  });
}

function playCardAction(card, index) {
  if (isSimpleEdition() && ["Banker", "President"].includes(card.title)) {
    logAction(`${card.title} is unavailable in the Simple Edition.`, "CARD");
    return;
  }
  if (card.title === "General" && !isActPhaseReady()) {
    logAction((translations[currentLang] || translations.en).txtGeneralActOnly, "CARD");
    return;
  }
  if (card.title === "Hitman" && investmentsLocked) {
    logAction((translations[currentLang] || translations.en).txtHitmanPrepareOnly, "CARD");
    return;
  }
  switch (card.title) {
    case "Banker":
      window.openLoanModal();
      break;

    case "President":
      window.openPresidentModal(index);
      break;

    case "General":
      window.activateGeneralCard(index);
      break;

    case "Spy":
      window.openSpyModal(index);
      break;

    case "Hitman":
      window.openHitmanModal(index);
      break;

    case "Merchant":
      window.activateMerchantCard(index);
      break;

    case "Atomic Bomb":
      window.openAtomicModal(index);
      break;

    default:
      logAction(`Activated ${card.title}!`, "CARD");
  }
}

// ------------------------------------------
// OTHER CARD ACTION HANDLERS
// ------------------------------------------
window.openLoanModal = function() {
  if (isSimpleEdition()) {
    logAction("Banker loans are unavailable in the Simple Edition.", "BANK");
    return;
  }
  const hasBankerCard = currentHand.some(card => card.title === "Banker");

  if (!hasBankerCard) {
    logAction("⚠️ Loan Refused: You must hold and click the Banker card in your hand to take a loan!", "BANK");
    return;
  }

  const amount = bankerLoanAmount(getAvailableTradeAmount("unallocated"));
  if (amount <= 0) {
    logAction("⚠️ You need at least 5 unallocated coins to take a Banker loan.", "BANK");
    return;
  }
  const modal = document.getElementById("loan-modal");
  setTxt("val-loan-input", amount);
  modal?.classList.remove("hidden");
};

window.confirmLoan = async function() {
  const amount = bankerLoanAmount(getAvailableTradeAmount("unallocated"));
  if (amount === 0) {
    logAction("⚠️ You need at least 5 unallocated coins to take a Banker loan.", "BANK");
    return;
  }

  const approved = await submitRoomEvent("TAKE_BANKER_LOAN", {});
  if (!approved) return;
  document.getElementById("loan-modal")?.classList.add("hidden");
  logAction(`🏦 Banker Loan approved by the server. Principal plus 20% interest is repaid at round end.`, "BANK");
};

window.activateGeneralCard = async function(cardIndex) {
  if (!isActPhaseReady()) {
    logAction((translations[currentLang] || translations.en).txtGeneralActOnly, "CARD");
    return;
  }
  const activated = await submitRoomEvent("ACTIVATE_GENERAL", {});
  if (!activated) return;
  currentHand.splice(cardIndex, 1);
  renderHand();
  logAction("🎖️ General Card Activated! You now have 2 Skirmish Field Attacks for this round.", "CARD");
};

window.activateMerchantCard = async function(cardIndex) {
  const activated = await submitRoomEvent("ACTIVATE_MERCHANT", {});
  if (!activated) return;
  logAction("💰 Merchant Card Activated! You will now earn +10% extra profit on all field buy and sell trade transactions this round.", "CARD");
};

window.openSpyModal = function(cardIndex) {
  if (isGlobalConditionActive("cold-war")) {
    logAction("🕊️ Cold War is active: Spy cards cannot be played this round. Your Spy card was not consumed.", "EVENT");
    return;
  }

  const select = document.getElementById("select-spy-target-deal");
  if (!select) return;

  select.innerHTML = "";

  if (pendingServerTrades.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No current-round trades available";
    select.appendChild(opt);
  }
  pendingServerTrades.forEach(deal => {
    const opt = document.createElement("option");
    opt.value = deal.id;
    const status = deal.status === "accepted" ? "Finalized — reverse" : "Pending — cancel";
    opt.textContent = `${status}: ${deal.proposerCountry} → ${deal.targetCountry} (${deal.offeredAmount} for ${deal.requestedAmount})`;
    select.appendChild(opt);
  });

  window.pendingCardIndex = cardIndex;
  document.getElementById("spy-modal")?.classList.remove("hidden");
};

window.confirmSpyInterruption = async function() {
  if (isGlobalConditionActive("cold-war")) {
    window.closeSpyModal();
    logAction("🕊️ Cold War interrupted this Spy action. Your Spy card remains available.", "EVENT");
    return;
  }

  const select = document.getElementById("select-spy-target-deal");
  const proposalId = String(select?.value || "");
  if (!proposalId) {
    logAction("🕵️ No current-round trade is available to break.", "SPY");
    return;
  }
  const completed = await submitRoomEvent("SPY_INTERRUPT", { proposalId });
  if (!completed) return;
  window.closeSpyModal();
  logAction("🕵️ Spy operation submitted to the server.", "SPY");
};

window.closeSpyModal = function() {
  document.getElementById("spy-modal")?.classList.add("hidden");
};

function handleHitmanResult(result) {
  const targetCountry = String(result?.targetCountry || "");
  const targetCard = result?.targetCard === "Spy" ? "Spy" : "General";
  const message = result?.succeeded
    ? `🕶️ Hitman success: ${targetCountry} had the ${targetCard} card. It was disabled.`
    : targetCountry
      ? `🕶️ Hitman failed: ${targetCountry} did not have the ${targetCard} card.`
      : "🕶️ Hitman failed: no opposing country was available.";
  logAction(message, "CARD");
  void refreshCurrentHand();
}

window.openHitmanModal = function(cardIndex) {
  if (investmentsLocked) {
    logAction((translations[currentLang] || translations.en).txtHitmanPrepareOnly, "CARD");
    return;
  }
  const countrySelect = document.getElementById("select-hitman-target-country");
  if (!countrySelect) return;
  countrySelect.replaceChildren();
  const targets = liveCountryNames(true);
  if (targets.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No opposing countries available";
    countrySelect.appendChild(empty);
  } else {
    targets.forEach(country => {
      const option = document.createElement("option");
      option.value = country;
      option.textContent = country;
      countrySelect.appendChild(option);
    });
  }
  window.pendingCardIndex = cardIndex;
  document.getElementById("hitman-modal")?.classList.remove("hidden");
};

window.confirmHitmanOperation = async function() {
  const targetCountry = document.getElementById("select-hitman-target-country")?.value;
  const targetCard = document.getElementById("select-hitman-target-card")?.value;
  if (!targetCountry || !["General", "Spy"].includes(targetCard)) {
    logAction("⚠️ Select an opposing country and card type to target.", "CARD");
    return;
  }
  const completed = await submitRoomEvent("HITMAN_STRIKE", { targetCountry, targetCard });
  if (!completed) return;
  window.closeHitmanModal();
};

window.closeHitmanModal = function() {
  document.getElementById("hitman-modal")?.classList.add("hidden");
};

window.openAtomicModal = function(cardIndex) {
  if (activeEdition !== "simple" && isGlobalConditionActive("pandemic")) {
    logAction("🦠 Pandemic is active: Atomic Bomb cards are deactivated this round.", "EVENT");
    return;
  }
  if (!investmentsLocked) {
    logAction("⚠️ Atomic Bomb requires round investments to be locked first!", "ATOMIC");
    return;
  }

  const selectCountry = document.getElementById("select-atomic-target-country");
  if (selectCountry) {
    selectCountry.innerHTML = "";
    liveCountryNames(true).forEach(country => {
      const opt = document.createElement("option");
      opt.value = country;
      opt.textContent = country;
      selectCountry.appendChild(opt);
    });
    if (!selectCountry.options.length) {
      logAction("⚠️ No other seated country is available to target.", "ATOMIC");
      return;
    }
    updateResourceSelectorLabels();
  }

  window.pendingCardIndex = cardIndex;
  document.getElementById("atomic-modal")?.classList.remove("hidden");
};

window.confirmAtomicStrike = async function() {
  const targetCountry = document.getElementById("select-atomic-target-country")?.value;
  const targetField = document.getElementById("select-atomic-target-field")?.value;

  if (!targetCountry || !targetField) {
    logAction("⚠️ Select a target country and field to detonate!", "ATOMIC");
    return;
  }

  const targetFieldKey = {
    Agriculture: "agri",
    Oil: "oil",
    Mines: "mines"
  }[targetField] || cleanStr(targetField);
  const completed = await submitRoomEvent("ATOMIC_STRIKE", { targetCountry, field: targetFieldKey });
  if (!completed) return;
  window.closeAtomicModal();
  void refreshCurrentHand();
  logAction(`☢️ Atomic Strike submitted to the server against ${targetCountry}.`, "ATOMIC");
};

window.closeAtomicModal = function() {
  document.getElementById("atomic-modal")?.classList.add("hidden");
};

window.initTvView = function() {
  applyEditionUi(activeEdition);
  soundManager.init();
  void refreshRoomSnapshot();
  renderActiveGlobalCondition();
  startHostEventPolling();
};

window.openEditionTvView = function() {
  window.open(`tv.html?${editionQuery()}`, "_blank", "noopener");
};