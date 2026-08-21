// ==========================================
// MASTER GAME STATE & SYSTEM DATABASE
// ==========================================
let coins = 0;                  
const MAX_PURCHASE_CAP = 500;   
let loans = 0;
let currentRound = 1;
let activeMode = 'player';
let currentLang = 'en';

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
    desc: "All resource multipliers become x1 this round.",
    resourceMultiplierOverride: 1
  },
  {
    id: "cold-war",
    title: "🕊️ Cold War",
    desc: "Spy cards cannot be played this round.",
    blocksSpyCards: true
  }
];

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
    txtOverviewTitle: "Player Overview",
    lblCountry: "Country:",
    lblCoins: "Total Coins Balance:",
    lblLoan: "Active Loan:",
    lblMerchantBonus: "Merchant Bonus Active:",
    txtReadyTitle: "🏁 Round Closure Consensus",
    txtReadyDesc: "Lock investments, finish all actions, and mark ready. The host can advance after every setup step is complete.",
    txtMultTitle: "Resource Multipliers",
    lblMultAgri: "Agriculture",
    lblMultOil: "Oil",
    lblMultMines: "Mines",
    txtBankTitle: "Market, Trading & Actions",
    btnBuyCoins: "Buy 100 Coins (Max 500)",
    btnOpenTrade: "🤝 Asymmetric Field Trade",
    btnFieldBattle: "⚔️ Skirmish Field Battle",
    txtInvestTitle: "Field Investments",
    lblUnallocated: "Unallocated:",
    btnLockInvest: "Lock In Investments",
    btnReadyNextRound: "🏁 Ready for Next Round",
    txtHandTitle: "Your Proficiency Hand (2 Cards)",
    txtClickCard: "👆 Click Card to Action",
    txtAnnouncements: "📣 Round Announcements",
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
    txtOverviewTitle: "Oyuncu Özeti",
    lblCountry: "Ülke:",
    lblCoins: "Toplam Coin Bakiyesi:",
    lblLoan: "Aktif Kredi:",
    lblMerchantBonus: "Tüccar Bonusu Aktif:",
    txtReadyTitle: "🏁 Raund Kapatma Konsensüsü",
    txtReadyDesc: "Yatırımları kilitleyin, tüm hamleleri bitirin ve hazır olun. Yönetici tüm hazırlıklar tamamlanınca ilerleyebilir.",
    txtMultTitle: "Kaynak Çarpanları",
    lblMultAgri: "Tarım",
    lblMultOil: "Petrol",
    lblMultMines: "Madenler",
    txtBankTitle: "Piyasa, Ticaret ve Eylemler",
    btnBuyCoins: "100 Coin Al (Maks 500)",
    btnOpenTrade: "🤝 Asimetrik Saha Ticareti",
    btnFieldBattle: "⚔️ Saha Çatışması Savaşı",
    txtInvestTitle: "Saha Yatırımları",
    lblUnallocated: "Ayrılmamış:",
    btnLockInvest: "Yatırımları Kilitle",
    btnReadyNextRound: "🏁 Sonraki Raund İçin Hazır",
    txtHandTitle: "Uzmanlık Kart Eliniz (2 Kart)",
    txtClickCard: "👆 Eylem İçin Karta Tıklayın",
    txtAnnouncements: "📣 Raund Duyuruları",
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
    txtOverviewTitle: "نمای کلی بازیکن",
    lblCountry: "کشور:",
    lblCoins: "موجودی کل سکه:",
    lblLoan: "وام فعال:",
    lblMerchantBonus: "پاداش بازرگان فعال:",
    txtReadyTitle: "🏁 اجماع بستن دور بازی",
    txtReadyDesc: "سرمایه‌گذاری‌ها را قفل کنید، اقدامات را تمام کنید و آماده شوید. میزبان پس از تکمیل همه مراحل می‌تواند ادامه دهد.",
    txtMultTitle: "ضریب‌های منابع",
    lblMultAgri: "کشاورزی",
    lblMultOil: "نفت",
    lblMultMines: "معادن",
    txtBankTitle: "بازار، تجارت و اقدامات",
    btnBuyCoins: "خرید ۱۰۰ سکه (حداکثر ۵۰۰)",
    btnOpenTrade: "🤝 تجارت نامتقارن زمینی",
    btnFieldBattle: "⚔️ نبرد درگیری زمینی",
    txtInvestTitle: "سرمایه‌گذاری‌های زمینی",
    lblUnallocated: "تخصیص‌نیافته:",
    btnLockInvest: "قفل سرمایه‌گذاری‌ها",
    btnReadyNextRound: "🏁 آماده برای دور بعد",
    txtHandTitle: "دست کارت‌های مهارت شما (۲ کارت)",
    txtClickCard: "👆 برای اقدام روی کارت کلیک کنید",
    txtAnnouncements: "📣 اطلاعیه‌های دور",
    btnHostDealUsed: "✓ کارت‌ها در این دور توزیع شدند",
    btnHostEventLocked: "ابتدا کارت‌ها را توزیع کنید",
    btnHostEventUsed: "✓ رویداد جهانی کشیده شد"
  }
};

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

  if (lang === "fa") {
    document.body.style.direction = "rtl";
  } else {
    document.body.style.direction = "ltr";
  }

  syncHostButtonsUI();
  updateReadyConsensusUI();
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
      renderHostCoinRequests();
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
        const destroyedAmount = investments[fieldName] || 0;
        investments[fieldName] = 0;
        coins = Math.max(0, coins - destroyedAmount);

        const slider = document.getElementById(`slider-${fieldName}`);
        if (slider) slider.value = 0;

        updateUI();
        logAction(`☢️ ATOMIC STRIKE! ${data.payload.attackerCountry} destroyed your ${fieldName.toUpperCase()} field and wiped ${destroyedAmount} invested coins.`, "ATOMIC");
      }
    } else if (data.type.endsWith("_ALLIANCE")) {
      handleAllianceRoomEvent(data);
    }
  };
}

let countryMultipliers = { agri: 1, oil: 1, mines: 1 };
let investments = { agri: 0, oil: 0, mines: 0 };
let activeRoomPlayers = [];
let pendingServerTrades = [];
let hostPollInFlight = false;

function liveCountryNames(excludeSelf = false) {
  const selfCountry = cleanStr(assignedCountry?.name || "");
  return activeRoomPlayers
    .map(player => player.country)
    .filter(country => country && (!excludeSelf || cleanStr(country) !== selfCountry));
}

function activeCountryCard(country) {
  return countryCards.find(card => cleanStr(card.name) === cleanStr(country));
}

function applyRoomSnapshot(room) {
  if (!room || !Array.isArray(room.players)) return;
  activeRoomPlayers = room.players;
  pendingServerTrades = Array.isArray(room.pendingTrades) ? room.pendingTrades : [];
  registeredPlayersCount = activeRoomPlayers.length || 1;
  lockedPlayersSet = new Set(
    activeRoomPlayers.filter(player => player.locked).map(player => cleanStr(player.country))
  );

  if (room.activeCondition?.id) {
    activateGlobalCondition(room.activeCondition);
    eventDrawnThisRound = true;
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
}

async function refreshRoomSnapshot() {
  if (typeof fetch !== "function") return;
  try {
    const response = await fetch("/api/room/state", { credentials: "same-origin" });
    if (!response.ok) return;
    const data = await response.json();
    applyRoomSnapshot(data.room);
  } catch (e) {}
}

function renderTvRoster() {
  const wrapper = document.getElementById("poker-seats-wrapper");
  if (!wrapper) return;
  wrapper.replaceChildren();
  activeRoomPlayers.forEach(player => {
    const country = activeCountryCard(player.country);
    const seat = document.createElement("article");
    seat.className = "poker-seat";
    const countryLabel = document.createElement("strong");
    countryLabel.textContent = player.country;
    const handleLabel = document.createElement("span");
    handleLabel.textContent = `${player.handle}${player.isHost ? " · Host" : ""}`;
    const statusLabel = document.createElement("small");
    statusLabel.textContent = player.locked ? "🔒 Investments locked" : "Planning investments";
    const resources = document.createElement("div");
    resources.className = "tv-seat-resources";
    [
      ["🌾", "Agriculture", country?.agri ?? "—"],
      ["🛢️", "Oil", country?.oil ?? "—"],
      ["⛏️", "Mines", country?.mines ?? "—"]
    ].forEach(([icon, label, value]) => {
      const item = document.createElement("span");
      item.title = label;
      item.textContent = `${icon} ×${value}`;
      resources.appendChild(item);
    });
    const investmentLabel = document.createElement("strong");
    investmentLabel.className = "tv-seat-investment";
    investmentLabel.textContent = player.totalInvestment == null
      ? "💰 Total investment: Not locked"
      : `💰 Total investment: ${player.totalInvestment} coins`;
    seat.append(countryLabel, handleLabel, resources, investmentLabel, statusLabel);
    if (country) seat.dataset.country = country.name;
    wrapper.appendChild(seat);
  });
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
  { title: "Banker", icon: "🏦", desc: "Allows taking loans up to 250 coins." },
  { title: "President", icon: "🏛️", desc: "Initiate strategic alliance mergers." },
  { title: "General", icon: "🎖️", desc: "Grants 2 skirmish attacks per round." },
  { title: "Spy", icon: "🕵️", desc: "Interrupt rival deal agreements." },
  { title: "Merchant", icon: "💰", desc: "Generates +10% extra profit on all field buy/sell transactions." },
  { title: "Atomic Bomb", icon: "☢️", desc: "Wipe out all investments in 1 target field." }
];

function setTxt(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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
  overlay.className = `modal-overlay result-alert-overlay result-alert-${result.tone || "neutral"}`;

  setTxt("game-result-icon", result.icon || "📣");
  setTxt("game-result-eyebrow", result.category || "GAME RESULT");
  setTxt("game-result-title", result.title || "Round Update");
  setTxt("game-result-summary", result.summary || "");
  setTxt("game-result-details", result.details || "");
  setTxt(
    "game-result-queue-status",
    gameResultAlertQueue.length > 0
      ? `${gameResultAlertQueue.length} more result${gameResultAlertQueue.length === 1 ? "" : "s"} waiting`
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
    round: currentRound,
    publishedAt: result?.publishedAt || Date.now()
  };

  queueGameResultAlert(payload);
  if (gameBroadcast) {
    gameBroadcast.postMessage({ type: "GAME_RESULT", payload });
  }
};

window.logAction = function(msg, tag = "INFO") {
  setTxt("action-log", msg);

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
    emptyDiv.textContent = "No announcements yet for this round.";
    container.appendChild(emptyDiv);
    return;
  }

  gameActivityLedger.forEach(item => {
    const row = document.createElement("div");
    row.className = "announcement-entry";

    const copy = document.createElement("div");
    copy.className = "announcement-copy";

    const meta = document.createElement("span");
    meta.className = "announcement-meta";
    meta.textContent = `R${item.round} · ${item.time} · ${item.country}`;

    const message = document.createElement("span");
    message.textContent = item.message;

    const tag = document.createElement("span");
    tag.className = "announcement-tag";
    tag.textContent = item.tag;

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
    const response = await fetch("/api/room/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    });
    const data = await response.json();
    if (!response.ok) {
      window.alert(data.error || "Could not exit the game. Please try again.");
      return;
    }

    clearPlayerGameMemory();
    gameBroadcast?.close();
    window.location.replace("index.html");
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
  } else if (event.type === "CONFIRM_ALLIANCE") {
    if (event.payload.allianceType === "Mega-Merger") {
      activePresidentCoalition = event.payload.data;
    } else {
      activeCounterUnion = event.payload.data;
    }
    pendingAllianceProposal = null;
    updateAllianceUI();
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
}

function applyHostEvent(event) {
  if (!event?.type) return;
  if (Number.isFinite(event.id)) {
    if (event.id <= lastHostEventId) return;
    lastHostEventId = event.id;
  }

  if (event.type === "PLAYER_JOINED" || event.type === "PLAYER_LEFT") {
    void refreshRoomSnapshot();
  } else if (event.type === "HOST_DEAL_CARDS") {
    if (cardsDealtThisRound) return;
    cardsDealtThisRound = true;
    void refreshCurrentHand();
    syncHostButtonsUI();
    logAction(`👑 Host dealt and locked 2 proficiency cards for Round ${currentRound}!`, "HOST");
  } else if (event.type === "HOST_DRAW_EVENT") {
    if (eventDrawnThisRound) return;
    eventDrawnThisRound = true;
    activateGlobalCondition(event.payload);
    syncHostButtonsUI();
    const eventTitle = activeGlobalCondition?.title || event.payload?.id || "Unknown Event";
    logAction(`🎲 Host drawn Global Event Card: ${eventTitle}!`, "EVENT");
  } else if (event.type === "EXECUTE_ROUND_CALCULATION") {
    const result = assignedCountry ? event.payload?.results?.[assignedCountry.name] : null;
    calculateAndAdvanceRound(result || null);
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
      cleanStr(item.country) === cleanStr(request.country) && item.amount === request.amount
    );
    if (matchingRequest >= 0) pendingCoinRequests.splice(matchingRequest, 1);
    renderHostCoinRequests();
  } else if (event.type === "LOCK_RESOURCES") {
    if (event.payload?.country) {
      lockedPlayersSet.add(cleanStr(event.payload.country));
      updateReadyConsensusUI();
      void refreshRoomSnapshot();
    }
  } else if (event.type === "SET_READY") {
    const country = cleanStr(event.payload?.country || "");
    if (event.payload?.ready) readyPlayersSet.add(country);
    else readyPlayersSet.delete(country);
    if (assignedCountry && country === cleanStr(assignedCountry.name)) {
      isLocalPlayerReadyToClose = Boolean(event.payload?.ready);
    }
    updateReadyConsensusUI();
  } else if (event.type === "REQUEST_COINS") {
    pendingCoinRequests.push(event.payload);
    renderHostCoinRequests();
  } else if (event.type === "ACTIVATE_GENERAL") {
    applyGeneralAllowance(event.payload);
  } else if (event.type === "TAKE_BANKER_LOAN") {
    if (assignedCountry && cleanStr(event.payload?.country) === cleanStr(assignedCountry.name)) {
      coins = Number(event.payload.coins) || 0;
      loans = Number(event.payload.loans) || 0;
      void refreshCurrentHand();
      updateUI();
    }
  } else if (event.type === "ACTIVATE_MERCHANT") {
    if (assignedCountry && cleanStr(event.payload?.country) === cleanStr(assignedCountry.name)) {
      isMerchantActive = true;
      void refreshCurrentHand();
      updateUI();
    }
  } else if (event.type === "ATOMIC_STRIKE") {
    if (assignedCountry && cleanStr(event.payload?.targetCountry) === cleanStr(assignedCountry.name)) {
      investments[event.payload.targetField] = 0;
      if (Number.isFinite(event.payload.targetCoins)) coins = event.payload.targetCoins;
      updateUI();
    }
    void refreshRoomSnapshot();
    publishGameResult({
      icon: "☢️",
      category: "ATOMIC BOMB RESULT",
      tone: "danger",
      title: "Atomic Strike Detonated",
      summary: `${event.payload.attackerCountry} launched an Atomic Bomb against ${event.payload.targetCountry}.`,
      details: `${event.payload.targetField} investments destroyed: ${event.payload.destroyed}.`
    });
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
    publishGameResult({
      icon: event.payload.approved ? "🤝" : "❌",
      category: "TRADE RESULT",
      tone: event.payload.approved ? "success" : "danger",
      title: event.payload.approved ? "Trade Completed" : "Trade Rejected",
      summary: event.payload.approved
        ? `${event.payload.proposerCountry} and ${event.payload.targetCountry} completed their exchange.`
        : `${event.payload.targetCountry} declined the trade from ${event.payload.proposerCountry}.`,
      details: event.payload.approved ? "Server wallet balances have been updated." : "No server wallet balances changed."
    });
  } else if (event.type === "SPY_INTERRUPT") {
    const myAssets = assignedCountry ? event.payload?.assets?.[assignedCountry.name] : null;
    if (myAssets) {
      coins = Number(myAssets.coins) || 0;
      if (myAssets.investments) investments = { ...myAssets.investments };
      updateUI();
    }
    void refreshCurrentHand();
    if (pendingTradeProposal?.id === event.payload.proposalId) {
      pendingTradeProposal = null;
      updateAllianceUI();
    }
    publishGameResult({
      icon: "🕵️",
      category: "SPY CARD RESULT",
      tone: "danger",
      title: "Spy Operation Successful",
      summary: `${event.payload.country} interrupted a pending server trade.`,
      details: "The targeted trade proposal was cancelled."
    });
  } else if (event.type === "SOLO_SKIRMISH") {
    applySoloSkirmishResult(event.payload, event.id);
  } else if (event.type === "ALLIANCE_SKIRMISH" || event.type.endsWith("_ALLIANCE")) {
    handleAllianceRoomEvent(event);
  }
}

async function submitHostCommand(type, payload) {
  if (!isRoomCreator || typeof fetch !== "function") return false;

  try {
    const response = await fetch("/api/host/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type, payload })
    });
    const data = await response.json();
    if (!response.ok) {
      logAction(`⛔ ${data.error || "The server rejected this host action."}`, "HOST");
      syncHostAccessUI();
      return false;
    }
    applyHostEvent(data.event);
    return true;
  } catch (e) {
    logAction("⛔ Could not contact the game server for this host action.", "HOST");
    return false;
  }
}

async function submitRoomEvent(type, payload) {
  if (typeof fetch !== "function") return false;

  try {
    const response = await fetch("/api/room/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type, payload })
    });
    const data = await response.json();
    if (!response.ok) {
      logAction(`⛔ ${data.error || "The server rejected this room event."}`, "ALLIANCE");
      return false;
    }
    applyHostEvent(data.event);
    return true;
  } catch (e) {
    logAction("⛔ Could not contact the game server for this alliance action.", "ALLIANCE");
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
      const response = await fetch(`/api/events?after=${lastHostEventId}`, { credentials: "same-origin" });
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

  const labels = translations[currentLang] || translations.en;

  if (dealBtn) {
    dealBtn.disabled = !isRoomCreator || cardsDealtThisRound;
    dealBtn.classList.toggle("round-action-used", cardsDealtThisRound);
    dealBtn.classList.remove("round-action-locked");
    dealBtn.textContent = cardsDealtThisRound ? labels.btnHostDealUsed : labels.btnHostDeal;
    dealBtn.setAttribute("aria-label", dealBtn.textContent);
  }

  if (eventBtn) {
    const eventLocked = !cardsDealtThisRound;
    const eventUsed = eventDrawnThisRound;
    eventBtn.disabled = !isRoomCreator || eventLocked || eventUsed;
    eventBtn.classList.toggle("round-action-locked", eventLocked);
    eventBtn.classList.toggle("round-action-used", eventUsed);
    eventBtn.textContent = eventUsed
      ? labels.btnHostEventUsed
      : eventLocked
        ? labels.btnHostEventLocked
        : labels.btnHostEvent;
    eventBtn.setAttribute("aria-label", eventBtn.textContent);
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
  const override = activeGlobalCondition?.resourceMultiplierOverride;
  if (Number.isFinite(override)) return override;
  return baseMultiplier || 1;
}

function renderActiveGlobalCondition() {
  const banner = document.getElementById("global-event-banner");
  const tvTicker = document.getElementById("tv-status-ticker");

  if (!activeGlobalCondition) {
    if (banner) banner.style.display = "none";
    if (tvTicker) tvTicker.textContent = "No active Global Condition this round.";
    return;
  }

  if (banner) {
    banner.style.display = "block";
    setTxt("global-event-name", activeGlobalCondition.title);
    setTxt("global-event-desc", activeGlobalCondition.desc);
  }

  if (tvTicker) {
    tvTicker.textContent = `GLOBAL CONDITION: ${activeGlobalCondition.title} — ${activeGlobalCondition.desc}`;
  }
}

function activateGlobalCondition(condition) {
  const matchingCondition = GLOBAL_CONDITION_CARDS.find(card => card.id === condition?.id);
  activeGlobalCondition = matchingCondition ? { ...matchingCondition } : null;

  try {
    if (activeGlobalCondition) {
      localStorage.setItem("world_war_active_global_condition", JSON.stringify(activeGlobalCondition));
    } else {
      localStorage.removeItem("world_war_active_global_condition");
    }
  } catch (e) {}

  renderActiveGlobalCondition();
  updateTradePreview();
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
    .filter(Boolean);
  renderHand();
}

async function refreshCurrentHand() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (!response.ok) return;
    const session = await response.json();
    applyServerHand(session.hand);
  } catch (e) {}
}

async function initMobilePlayerSession() {
  let session;
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (!response.ok) {
      window.location.href = "index.html";
      return;
    }
    session = await response.json();
    if (!session.player) {
      window.location.href = "index.html";
      return;
    }
  } catch (e) {
    setTxt("action-log", "Unable to connect to the game server.");
    return;
  }

  const handleName = session.player.handle;
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
    if (session.economy.investments) {
      investments = { ...session.economy.investments };
      investmentsLocked = true;
    }
  }

  gameActivityLedger = safeStorageGet("world_war_round_announcements", []);
  renderRoundAnnouncements();

  const savedLang = safeStorageGet("selected_lang", "en");
  const langSelect = document.getElementById("lang-select");
  if (langSelect) langSelect.value = savedLang;

  // Attach language manually if not bound
  if(typeof window.changeLanguage === "function") window.changeLanguage(savedLang);

  updateCountryUI();
  updateUI();
  syncHostAccessUI();
  syncHostButtonsUI();
  updateReadyConsensusUI();
  setTxt("player-country", `${assignedCountry.name} (${handleName})`);
  logAction(`Welcome ${handleName}! Your wallet is synchronized with the game server.`, "SYSTEM");
  startHostEventPolling();
}

window.initController = initMobilePlayerSession;

function updateCountryUI() {
  if (!assignedCountry) return;
  setTxt("mult-agri", `x${getEffectiveResourceMultiplier("agri")}`);
  setTxt("mult-oil", `x${getEffectiveResourceMultiplier("oil")}`);
  setTxt("mult-mines", `x${getEffectiveResourceMultiplier("mines")}`);
}

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
  if (isGlobalConditionActive("pandemic")) return "Pandemic: all resource multipliers are x1";
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
  const selectPartner = document.getElementById("select-trade-partner");
  if (selectPartner) {
    selectPartner.innerHTML = "";
    liveCountryNames(true).forEach(country => {
      const opt = document.createElement("option");
      opt.value = country;
      opt.textContent = country;
      selectPartner.appendChild(opt);
    });
    if (!selectPartner.options.length) logAction("⚠️ No other seated country is available to trade.", "TRADE");
  }

  updateOfferSliderCapacity();
  updateTradePreview();
  document.getElementById("trade-modal")?.classList.remove("hidden");
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

  const event = GLOBAL_CONDITION_CARDS[Math.floor(Math.random() * GLOBAL_CONDITION_CARDS.length)];
  await submitHostCommand("HOST_DRAW_EVENT", event);
};

// ==========================================
// COIN PURCHASE REQUEST ENGINE
// ==========================================
window.requestBuyCoins = async function() {
  if (coins + 100 > MAX_PURCHASE_CAP) {
    logAction(`🛑 Purchase Capped: You already hold the maximum limit of 500 coins.`, "BANK");
    return;
  }

  const submitted = await submitRoomEvent("REQUEST_COINS", {});
  if (!submitted) return;

  logAction(`⏳ Coin Purchase Request submitted! Waiting for Host Approval (+100 Coins)...`, "BANK");
};

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
    approveBtn.onclick = () => resolveCoinRequest(idx, true);

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "btn btn-small btn-danger";
    rejectBtn.textContent = "❌ Reject";
    rejectBtn.onclick = () => resolveCoinRequest(idx, false);

    btnGroup.appendChild(approveBtn);
    btnGroup.appendChild(rejectBtn);

    item.appendChild(label);
    item.appendChild(btnGroup);
    container.appendChild(item);
  });
}

async function resolveCoinRequest(index, approved) {
  if (!requireRoomCreator("resolve coin requests")) return;
  const req = pendingCoinRequests[index];
  if (!req) return;

  await submitHostCommand("RESOLVE_COIN_REQUEST", {
    requestId: req.requestId,
    approved: approved
  });
}

function updateUI() {
  setTxt("player-coins", coins);
  setTxt("player-loan", loans);
  setTxt("total-budget", coins);
  setTxt("merchant-status", isMerchantActive ? "Yes (+10%) ✅" : "No ❌");

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

  updateOfferSliderCapacity();
  updateAllianceUI();
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
  updateReadyConsensusUI();
  logAction(`✅ Locked field investments: Agri(${investments.agri}), Oil(${investments.oil}), Mines(${investments.mines}).`, "INVEST");
};

// ==========================================
// SKIRMISH BATTLE ENGINE
// ==========================================
window.openSkirmishModal = function() {
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

  setTxt("val-attacks-left", skirmishMaxAllowedAttacks - skirmishAttacksExecuted);
  document.getElementById("skirmish-modal")?.classList.remove("hidden");
};

window.closeSkirmishModal = function() {
  document.getElementById("skirmish-modal")?.classList.add("hidden");
};

window.executeSkirmishAttack = async function() {
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
  if (unionBanner) unionBanner.style.display = "none";
  if (proposalBanner) {
    proposalBanner.style.display = "none";
    proposalBanner.classList.add("hidden");
  }
  if (allianceAttackButton) allianceAttackButton.style.display = "none";

  if (pendingTradeProposal && cleanStr(pendingTradeProposal.targetCountry) === myCountryClean) {
    if (proposalBanner) {
      proposalBanner.classList.remove("hidden");
      proposalBanner.style.display = "block";
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
        proposalBanner.classList.remove("hidden");
        proposalBanner.style.display = "block";
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
        allianceAttackButton.disabled = Boolean(activePresidentCoalition.attacksUsed);
        allianceAttackButton.textContent = activePresidentCoalition.attacksUsed
          ? "✓ Alliance Skirmish Used"
          : "⚔️ Alliance Skirmish";
      }
    } else if (!activeCounterUnion) {
      if (unionBanner) unionBanner.style.display = "block";
    }
  }

  if (activeCounterUnion && Array.isArray(activeCounterUnion.members)) {
    if (unionBanner) unionBanner.style.display = "none";

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
        allianceAttackButton.disabled = Boolean(activeCounterUnion.attacksUsed);
        allianceAttackButton.textContent = activeCounterUnion.attacksUsed
          ? "✓ Alliance Skirmish Used"
          : "⚔️ Alliance Skirmish";
      }
    }
  }
}

function currentInitiatedAlliance() {
  const myCountry = assignedCountry ? cleanStr(assignedCountry.name) : "";
  return [activePresidentCoalition, activeCounterUnion].find(
    alliance => alliance && cleanStr(alliance.initiator) === myCountry
  ) || null;
}

window.openAllianceSkirmishModal = function() {
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
  document.getElementById("alliance-skirmish-modal")?.classList.remove("hidden");
};

window.closeAllianceSkirmishModal = function() {
  document.getElementById("alliance-skirmish-modal")?.classList.add("hidden");
};

window.executeAllianceSkirmish = async function() {
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

function calculateAndAdvanceRound(canonicalResult = null) {
  if (pendingOutgoingTrade) {
    refundTradeEscrow(pendingOutgoingTrade);
    pendingOutgoingTrade = null;
    logAction("↩️ Unresolved trade offer returned before round calculation.", "TRADE");
  }

  let earnedAgriYield = 0;
  let earnedOilYield = 0;
  let earnedMinesYield = 0;
  const completedCondition = activeGlobalCondition ? { ...activeGlobalCondition } : null;

  const activeAlliance = activePresidentCoalition || activeCounterUnion;
  const agriMultiplier = getEffectiveResourceMultiplier("agri");
  const oilMultiplier = getEffectiveResourceMultiplier("oil");
  const minesMultiplier = getEffectiveResourceMultiplier("mines");

  if (activeAlliance) {
    const totalMembers = activeAlliance.members.length;
    const livePool = activeAlliance.pool || {
      agri: activeAlliance.totalAgri,
      oil: activeAlliance.totalOil,
      mines: activeAlliance.totalMines
    };
    const poolAgriTotal = livePool.agri * agriMultiplier;
    const poolOilTotal = livePool.oil * oilMultiplier;
    const poolMinesTotal = livePool.mines * minesMultiplier;

    // Guaranteed proportional ratio (equal split approximation)
    const playerShareRatio = 1 / totalMembers;

    earnedAgriYield = Math.floor(poolAgriTotal * playerShareRatio);
    earnedOilYield = Math.floor(poolOilTotal * playerShareRatio);
    earnedMinesYield = Math.floor(poolMinesTotal * playerShareRatio);
  } else {
    earnedAgriYield = Math.floor(investments.agri * agriMultiplier * 1.5);
    earnedOilYield = Math.floor(investments.oil * oilMultiplier * 1.5);
    earnedMinesYield = Math.floor(investments.mines * minesMultiplier * 1.5);
  }

  if (isGlobalConditionActive("global-warming")) {
    earnedAgriYield = Math.floor(earnedAgriYield * activeGlobalCondition.agricultureIncomeMultiplier);
    earnedOilYield = Math.floor(earnedOilYield * activeGlobalCondition.oilIncomeMultiplier);
  }

  const grossRoundProfit = earnedAgriYield + earnedOilYield + earnedMinesYield;

  const balanceBeforeRound = coins;
  let loanRepaymentDue = 0;
  let loanRepaymentCollected = 0;
  if (loans > 0) {
    loanRepaymentDue = Math.floor(loans * 1.20);
    loanRepaymentCollected = Math.min(
      Math.max(0, coins + grossRoundProfit),
      loanRepaymentDue
    );
    loans = loanRepaymentDue - loanRepaymentCollected;
  }

  coins = Math.max(0, coins + grossRoundProfit - loanRepaymentCollected);
  if (canonicalResult) {
    coins = Number(canonicalResult.coins) || 0;
    loans = Number(canonicalResult.loans) || 0;
    earnedAgriYield = 0;
    earnedOilYield = 0;
    earnedMinesYield = 0;
    loanRepaymentCollected = Number(canonicalResult.repayment) || 0;
  }
  const netBalanceChange = coins - balanceBeforeRound;

  currentRound = Math.min(currentRound + 1, 3);
  resetRoundAnnouncements();

  investmentsLocked = false;
  isMerchantActive = false;
  activePresidentCoalition = null;
  activeCounterUnion = null;
  pendingAllianceProposal = null;
  pendingTradeProposal = null;
  cardsDealtThisRound = false;
  eventDrawnThisRound = false;
  clearActiveGlobalCondition();
  currentHand = [];
  renderHand();
  isLocalPlayerReadyToClose = false;
  readyPlayersSet.clear();
  lockedPlayersSet.clear();
  skirmishAttacksExecuted = 0;
  skirmishMaxAllowedAttacks = 1;

  investments = { agri: 0, oil: 0, mines: 0 };
  ["slider-agri", "slider-oil", "slider-mines"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = false;
      el.value = "0";
    }
  });

  const lockBtn = document.getElementById("btn-lock-invest");
  if (lockBtn) {
    lockBtn.disabled = false;
    lockBtn.textContent = "Lock In Investments";
  }

  const readyBtn = document.getElementById("btn-player-ready");
  if (readyBtn) {
    readyBtn.textContent = (translations[currentLang] || translations.en).btnReadyNextRound;
    readyBtn.className = "btn btn-success btn-large";
  }

  syncHostButtonsUI();
  updateReadyConsensusUI();
  updateAllianceUI();
  updateUI();

  setTxt("current-phase", `Round ${currentRound} / 3`);
  const conditionSummary = completedCondition
    ? ` Global Condition resolved: ${completedCondition.title}.`
    : "";
  const netBalanceLabel = netBalanceChange >= 0 ? `+${netBalanceChange}` : `${netBalanceChange}`;
  const loanSummary = loanRepaymentDue > 0
    ? ` Loan Repayment: -${loanRepaymentCollected} of ${loanRepaymentDue}. Remaining Loan: ${loans}.`
    : " Loan Repayment: -0.";
  const canonicalSummary = canonicalResult
    ? ` Server settlement: Gross +${canonicalResult.grossProfit} Coins.`
    : ` Gross +${grossRoundProfit} Coins (Agri:${earnedAgriYield}, Oil:${earnedOilYield}, Mines:${earnedMinesYield}).`;
  logAction(`🎬 Round ${currentRound} is open. Previous round result:${canonicalSummary}${loanSummary} Net balance change: ${netBalanceLabel} Coins.${conditionSummary} Deal cards and one Global Event are ready.`, "ROUND");
}

// ==========================================
// PROFICIENCY CARDS HAND (STRICTLY 2 CARDS)
// ==========================================
function renderHand() {
  const container = document.getElementById("cards-container");
  if (!container) return;

  container.replaceChildren();

  const displayCards = currentHand.slice(0, 2);

  displayCards.forEach((card, index) => {
    const element = document.createElement("div");
    element.className = "prof-card";
    element.style.cursor = "pointer";

    element.onclick = () => playCardAction(card, index);

    const iconDiv = document.createElement("div");
    iconDiv.className = "card-icon";
    iconDiv.textContent = card.icon;

    const titleDiv = document.createElement("div");
    titleDiv.className = "card-title";
    titleDiv.textContent = card.title;

    const descDiv = document.createElement("div");
    descDiv.className = "card-desc";
    descDiv.textContent = card.desc;

    element.appendChild(iconDiv);
    element.appendChild(titleDiv);
    element.appendChild(descDiv);
    container.appendChild(element);
  });
}

function playCardAction(card, index) {
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
  const hasBankerCard = currentHand.some(card => card.title === "Banker");

  if (!hasBankerCard) {
    logAction("⚠️ Loan Refused: You must hold and click the Banker card in your hand to take a loan!", "BANK");
    return;
  }

  const modal = document.getElementById("loan-modal");
  const slider = document.getElementById("slider-loan");
  if (slider) {
    slider.max = "250";
    slider.value = "250";
    setTxt("val-loan-input", "250");
  }
  modal?.classList.remove("hidden");
};

window.confirmLoan = async function() {
  const slider = document.getElementById("slider-loan");
  const amount = Math.max(0, parseInt(slider?.value, 10) || 0);
  if (amount === 0) {
    logAction("⚠️ Choose a loan amount first.", "BANK");
    return;
  }

  const approved = await submitRoomEvent("TAKE_BANKER_LOAN", { amount });
  if (!approved) return;
  document.getElementById("loan-modal")?.classList.add("hidden");
  logAction(`🏦 Banker Loan approved by the server. Principal plus 20% interest is repaid at round end.`, "BANK");
};

window.activateGeneralCard = async function(cardIndex) {
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
    opt.textContent = "No pending server trades";
    select.appendChild(opt);
  }
  pendingServerTrades.forEach(deal => {
    const opt = document.createElement("option");
    opt.value = deal.id;
    opt.textContent = `${deal.proposerCountry} → ${deal.targetCountry} (${deal.offeredAmount} for ${deal.requestedAmount})`;
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
    logAction("🕵️ No pending server trade is available to interrupt.", "SPY");
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

window.openAtomicModal = function(cardIndex) {
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
  void refreshRoomSnapshot();
  renderActiveGlobalCondition();
  startHostEventPolling();
};