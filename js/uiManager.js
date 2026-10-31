// ============================================================================
// Brass: Birmingham - UI Manager
// Enhanced with phase bar, game log, turn transitions, card selection mode
// ============================================================================

class UIManager {
    constructor() {
        this.state = null;
        this.logic = null;
        this.renderer = null;
        this.selectedAction = null;
        this.selectedCard = null;
        this.actionStep = 0; // Multi-step action tracking
        this.pendingData = {}; // Data accumulated during multi-step actions
        this.gameLog = []; // Game log entries
        this.previousPlayerId = null; // Track player changes for transitions
        // Online multiplayer
        this.myId = null;          // my seat index (from server)
        this.net = null;           // network client (main.js)
        this.waiting = false;      // action sent, awaiting server
        this.pendingBonus = null;  // merchant develop bonus prompt from server
        this.seats = [];
        this.connected = [];
        this.roomId = null;
    }

    init(gameState, gameLogic, boardRenderer, opts = {}) {
        this.state = gameState;
        this.logic = gameLogic;
        this.renderer = boardRenderer;
        this.net = opts.net || null;
        if (opts.myId !== undefined) this.myId = opts.myId;

        this.bindEvents();
        this.previousPlayerId = this.state.currentPlayerId;
    }

    // ========================================================================
    // Online: server-driven state
    // ========================================================================

    isMyTurn() {
        return !!this.state && !this.state.gameOver && this.myId !== null &&
            this.state.currentPlayerId === this.myId && !this.waiting && !this.pendingBonus;
    }

    // msg = per-player view from the server (only MY hand is real)
    applyServerState(msg) {
        const firstTime = !this.gameLogLoaded;
        const prevPlayer = this.state ? this.state.currentPlayerId : null;
        const st = Object.assign(Object.create(GameState.prototype), msg.view);
        this.state = st;
        this.logic = new GameLogic(st);
        this.myId = msg.you;
        this.roomId = msg.roomId;
        this.seats = msg.seats || [];
        this.connected = msg.connected || [];
        this.gameLog = (msg.log || []).slice().reverse();
        this.gameLogLoaded = true;
        this.waiting = false;
        this.pendingBonus = msg.pendingBonus || null;

        if (!this.isMyTurn() && this.selectedAction) {
            this.selectedAction = null;
            this.actionStep = 0;
            this.pendingData = {};
            this.selectedCard = null;
            this.renderer.clearHighlights();
            this.closeModal();
        }

        document.getElementById('game-screen').classList.toggle('not-my-turn', !this.isMyTurn());
        this.refresh();
        this.renderLog();

        if (!firstTime && prevPlayer !== st.currentPlayerId && !st.gameOver) {
            this.showTurnTransition(st.currentPlayer);
        }

        if (this.pendingBonus) this.showBonusModal();

        const ev = msg.event;
        if (ev) {
            const key = `brass-ev-${this.roomId}-${this.myId}`;
            const seen = Number(sessionStorage.getItem(key) || 0);
            if (ev.seq > seen) {
                sessionStorage.setItem(key, String(ev.seq));
                if (ev.type === 'scoring') this.showScoring(ev.title, ev.scores);
                else if (ev.type === 'gameover') this.showGameOver(ev.scores);
            }
        }
    }

    onServerResult(msg) {
        this.waiting = false;
        if (msg.message) this.showToast(msg.message, msg.ok ? 'success' : 'error');
        document.getElementById('game-screen').classList.toggle('not-my-turn', !this.isMyTurn());
        this.updateActionButtons();
    }

    sendAction(msg) {
        if (!this.net || !this.net.send({ type: 'action', ...msg })) {
            this.showToast('Not connected — please wait', 'error');
            return;
        }
        this.waiting = true;
        this.selectedAction = null;
        this.actionStep = 0;
        this.pendingData = {};
        this.selectedCard = null;
        this.renderer.clearHighlights();
        this.closeModal();
        document.getElementById('game-screen').classList.add('not-my-turn');
        this.updateHand();
        this.updateActionButtons();
        this.updatePhaseBar();
    }

    // ========================================================================
    // Event Binding
    // ========================================================================

    bindEvents() {
        // Action buttons
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = btn.dataset.action;
                this.onActionSelected(action);
            });
        });

        // Modal close
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());

        // Board click events (delegated)
        document.getElementById('game-board').addEventListener('click', (e) => {
            this.onBoardClick(e);
        });

        // Phase bar cancel button
        if (typeof ActionIcons !== 'undefined') ActionIcons.mount();

        // Artwork is detected asynchronously; redraw the panels that use it.
        window.addEventListener('boardassets:ready', () => {
            if (!this.state) return;
            this.updateHand();
            this.updatePlayerMat();
            this.updateMarkets();
        });

        document.getElementById('phase-cancel-btn').addEventListener('click', () => {
            this.cancelAction();
        });

        // Escape key to cancel action
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.selectedAction) {
                    this.cancelAction();
                }
            }
        });
    }

    // ========================================================================
    // Refresh UI
    // ========================================================================

    refresh() {
        this.updateTopBar();
        this.updatePlayerPanels();
        this.updateHand();
        this.updateActionButtons();
        this.updatePlayerMat();
        this.updateMarkets();
        this.updatePhaseBar();
        this.renderer.fullUpdate(this.state);
        this.updateBuildHints();
    }

    // Lights every currently legal build slot while it's my turn and no action
    // is chosen yet (same legality check as the build flow).
    updateBuildHints() {
        if (!this.renderer) return;
        const on = this.buildHintsOn !== false;
        if (!on || !this.isMyTurn() || this.selectedAction) { this.renderer.clearBuildHints(); return; }
        let targets = [];
        try { targets = this.logic.getValidBuildTargets(this.myId); } catch (e) { targets = []; }
        this.renderer.showBuildHints(targets);
    }

    updateTopBar() {
        const player = this.state.currentPlayer;
        document.getElementById('era-label').textContent =
            this.state.era === ERA.CANAL ? 'Canal Era' : 'Rail Era';
        document.getElementById('round-label').textContent =
            `Round ${this.state.round} | Deck: ${this.state.drawDeck.length}`;

        const playerLabel = document.getElementById('current-player-label');
        playerLabel.textContent = this.state.gameOver ? 'Game Over'
            : (player.id === this.myId ? (this.pendingBonus ? 'Your Turn — choose bonus' : 'Your Turn')
            : `${player.name}'s Turn`);
        playerLabel.style.backgroundColor = player.color;
        playerLabel.style.color = player.colorName === 'White' ? '#1a1510' : 'white';

        const actionsLeft = this.state.actionsPerTurn - this.state.actionsThisTurn;
        document.getElementById('actions-remaining-label').textContent =
            `${actionsLeft} action${actionsLeft !== 1 ? 's' : ''} left`;

        // Market prices
        const coalPrice = this.state.getCoalPrice();
        const ironPrice = this.state.getIronPrice();
        document.getElementById('coal-price').textContent =
            coalPrice === Infinity ? 'Empty' : `£${coalPrice}`;
        document.getElementById('iron-price').textContent =
            ironPrice === Infinity ? 'Empty' : `£${ironPrice}`;
    }

    updatePlayerPanels() {
        const container = document.getElementById('player-panels');
        container.innerHTML = '';

        for (const player of this.state.players) {
            const isActive = player.id === this.state.currentPlayerId;
            const panel = document.createElement('div');
            panel.className = `player-panel${isActive ? ' active' : ''}`;
            // Set the left border color via the panel itself (CSS uses border-left)
            panel.style.borderLeftColor = player.color;

            panel.innerHTML = `
                <div class="player-panel-header">
                    <span class="player-panel-name" style="color: ${player.color}">${player.name}${player.isAI ? ' <span class="ai-chip">AI</span>' : ''}${player.id === this.myId ? ' <span class="ai-chip me-chip">You</span>' : ''}${!player.isAI && this.connected.length && !this.connected[player.id] ? ' <span class="ai-chip offline-chip">Offline</span>' : ''}${this.state.gameOver ? '' : (isActive ? ' <span class="ai-chip turn-chip">Acting</span>' : ' <span class="ai-chip wait-chip">Waiting</span>')}</span>
                    <span class="player-panel-vp">${player.vp} <span style="font-size:10px;font-weight:400;color:var(--text-muted)">VP</span></span>
                </div>
                <div class="player-panel-stats">
                    <span class="player-panel-stat" title="Money" style="color:#c9a84c">£${player.money}</span>
                    <span class="player-panel-stat" title="Income level">&#8679; ${this.state.getIncomeLevel(player.id)}</span>
                    <span class="player-panel-stat" title="Cards">${player.hand.length} cds</span>
                    <span class="player-panel-stat" title="Links">
                        ${this.state.era === ERA.CANAL ? player.linksRemaining.canal : player.linksRemaining.rail} lnk
                    </span>
                </div>
            `;
            container.appendChild(panel);
        }
    }

    updateHand() {
        const container = document.getElementById('player-hand');
        container.innerHTML = '';

        if (this.myId === null) return;
        const player = this.state.players[this.myId];
        const playerId = this.myId;
        const inCardSelectMode = this.actionStep > 0 && this.selectedAction;

        // Get valid card indices for current action
        let validCardIndices = null;
        if (inCardSelectMode) {
            const target = this.selectedAction === ACTIONS.BUILD ? this.pendingData : null;
            validCardIndices = this.logic.getValidCardsForAction(playerId, this.selectedAction, target);
        }

        const cardArt = typeof BoardAssets !== 'undefined' && BoardAssets.cardsReady();

        player.hand.forEach((card, idx) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            cardEl.dataset.index = idx;

            // With the printed card faces supplied locally, the card IS the
            // artwork — no drawn type/icon/name layout on top of it.
            const art = cardArt ? BoardAssets.cardUrl(card) : null;
            if (art) {
                cardEl.classList.add('card-art');
                if (card.type === CARD_TYPES.LOCATION) cardEl.classList.add('location-card');
                else if (card.type === CARD_TYPES.INDUSTRY) cardEl.classList.add('industry-card');
                else cardEl.classList.add('wild-card');
                const artLabel = card.type === CARD_TYPES.LOCATION
                    ? ''
                    : `<span class="card-art-label">${card.name || (card.type === CARD_TYPES.WILD_LOCATION ? 'Wild Location' : 'Wild Industry')}</span>`;
                cardEl.innerHTML = `<img src="${art}" alt="${card.type === CARD_TYPES.LOCATION ? card.name || '' : ''}" draggable="false">${artLabel}`;
                if (this.selectedCard === idx) cardEl.classList.add('selected');
                if (this.selectedAction === ACTIONS.SCOUT &&
                        this.pendingData.scoutCards && this.pendingData.scoutCards.includes(idx)) {
                    cardEl.classList.add('scout-queued');
                }
                if (inCardSelectMode && validCardIndices) {
                    cardEl.classList.add(validCardIndices.includes(idx) ? 'valid-discard' : 'invalid-discard');
                }
                cardEl.addEventListener('click', () => this.onCardClicked(idx));
                container.appendChild(cardEl);
                return;
            }

            if (card.type === CARD_TYPES.LOCATION) {
                cardEl.classList.add('location-card');
                const city = CITIES[card.location];
                const regionColor = city ? REGION_COLORS[city.region]?.fill : '#4a4a4a';

                // Apply region color as background tint so cards are visually distinct by
                // region, matching the same region tint used on the board itself.
                if (regionColor) {
                    cardEl.style.borderColor = regionColor;
                    cardEl.style.boxShadow = `0 0 6px ${regionColor}55`;
                    cardEl.style.setProperty('--region-tint', `${regionColor}30`);
                }

                cardEl.innerHTML = `
                    <div class="card-type">Location</div>
                    <div style="font-size:20px;margin:4px 0;">📍</div>
                    <div class="card-name">${card.name}</div>
                `;
            } else if (card.type === CARD_TYPES.INDUSTRY) {
                cardEl.classList.add('industry-card');
                const isDual = card.industryTypes.length > 1;
                const display = INDUSTRY_DISPLAY[card.industryTypes[0]];
                cardEl.style.setProperty('--industry-ribbon-color', display.color);
                let iconHtml;
                if (isDual) {
                    // Dual "Cotton Mill or Manufacturer" card — show both icons
                    const icons = card.industryTypes
                        .map(t => IndustryIcons.renderMarkup(t, 20, 'full') || INDUSTRY_DISPLAY[t].icon)
                        .join('');
                    iconHtml = `<div style="display:flex;justify-content:center;gap:2px;">${icons}</div>`;
                } else {
                    const svgIcon = IndustryIcons.renderMarkup(card.industryTypes[0], 30, 'full');
                    iconHtml = svgIcon || `<div class="card-icon">${display.icon}</div>`;
                }
                cardEl.innerHTML = `
                    <div class="card-type">Industry</div>
                    ${iconHtml}
                    <div class="card-name">${card.name}</div>
                `;
            } else if (card.type === CARD_TYPES.WILD_LOCATION) {
                cardEl.classList.add('wild-card');
                cardEl.innerHTML = `
                    <div class="card-type">Wild</div>
                    <div class="card-icon">&#10038;</div>
                    <div class="card-name">Location</div>
                `;
            } else if (card.type === CARD_TYPES.WILD_INDUSTRY) {
                cardEl.classList.add('wild-card');
                cardEl.innerHTML = `
                    <div class="card-type">Wild</div>
                    <div class="card-icon">&#10040;</div>
                    <div class="card-name">Industry</div>
                `;
            }

            if (this.selectedCard === idx) {
                cardEl.classList.add('selected');
            }

            // Mark cards already queued for scout discard
            if (this.selectedAction === ACTIONS.SCOUT &&
                    this.pendingData.scoutCards && this.pendingData.scoutCards.includes(idx)) {
                cardEl.classList.add('scout-queued');
            }

            // Card selection mode visual states
            if (inCardSelectMode && validCardIndices) {
                if (validCardIndices.includes(idx)) {
                    cardEl.classList.add('valid-discard');
                } else {
                    cardEl.classList.add('invalid-discard');
                }
            }

            cardEl.addEventListener('click', () => this.onCardClicked(idx));
            container.appendChild(cardEl);
        });

        // Toggle card-select-mode class on bottom panel
        const bottomPanel = document.getElementById('bottom-panel');
        if (inCardSelectMode) {
            bottomPanel.classList.add('card-select-mode');
        } else {
            bottomPanel.classList.remove('card-select-mode');
        }
    }

    updateActionButtons() {
        this.updateBuildHints();
        const playerId = this.state.currentPlayerId;
        if (!this.isMyTurn()) {
            document.querySelectorAll('.action-btn').forEach(btn => {
                btn.disabled = true;
                btn.classList.remove('active');
                btn.title = this.state.gameOver ? 'Game Over' : 'Waiting for other players';
            });
            return;
        }

        document.querySelectorAll('.action-btn').forEach(btn => {
            const action = btn.dataset.action;
            const canDo = this.logic.canPerformAction(action, playerId);
            btn.disabled = !canDo;
            btn.classList.toggle('active', this.selectedAction === action);

            // Disabled tooltips
            if (!canDo) {
                const reason = this.logic.getDisabledReason(action, playerId);
                btn.title = reason || 'Cannot perform this action';
            } else {
                // Restore default tooltips
                const defaultTitles = {
                    build: 'Build an industry tile',
                    network: 'Build a canal or rail link',
                    develop: 'Remove lower-level tiles',
                    sell: 'Sell cotton, goods, or pottery',
                    loan: 'Take a £30 loan',
                    scout: 'Trade 3 cards for 2 wild cards',
                    pass: 'Pass (discard a card)',
                };
                btn.title = defaultTitles[action] || '';
            }
        });
    }

    updatePlayerMat() {
        const container = document.getElementById('player-mat');
        container.innerHTML = '';

        if (this.myId === null) return;
        const remaining = this.state.getRemainingTiles(this.myId);

        for (const [type, data] of Object.entries(remaining)) {
            const display = INDUSTRY_DISPLAY[type];
            const div = document.createElement('div');
            div.className = 'mat-industry';

            let tilesHtml = '';
            const allTiles = this.state.players[this.myId].industryTiles[type];
            const chips = typeof BoardAssets !== 'undefined' && BoardAssets.tilesReady();
            const iconMarkup = chips ? null : IndustryIcons.renderMarkup(type, 12, 'full');
            allTiles.forEach(tile => {
                const cls = tile.used ? 'mat-tile used' : 'mat-tile available';
                // Cost details (money, coal, iron)
                const costParts = [`£${tile.cost}`];
                if (tile.costCoal > 0) costParts.push(`${tile.costCoal} coal`);
                if (tile.costIron > 0) costParts.push(`${tile.costIron} iron`);
                const costStr = costParts.join(' + ');

                // Era availability
                const eraStr = (tile.canalEra && tile.railEra) ? 'Canal & Rail'
                             : tile.canalEra ? 'Canal only' : 'Rail only';

                // Industry-specific traits
                let extra = '';
                if (tile.beersToSell !== null && tile.beersToSell !== undefined) {
                    extra = ` | Sell: ${tile.beersToSell} beer`;
                } else if (tile.resourceCubes > 0) {
                    extra = ` | Produces: ${tile.resourceCubes} cubes`;
                }
                if (!tile.canDevelop) {
                    extra += ' | Cannot develop';
                }

                const tooltip = `${display.name} Lv${tile.level} (${tile.used ? 'Used' : 'Available'})\n` +
                                `Cost: ${costStr}\n` +
                                `Flip: ${tile.vp} VP, +${tile.income} Income${extra}\n` +
                                `Era: ${eraStr}`;
                if (chips) {
                    // The chip face already carries its level and industry.
                    const art = BoardAssets.tileUrl(type, tile.level, false);
                    tilesHtml += `<div class="${cls} mat-tile-art" data-type="${type}" title="${tooltip}">
                        <img src="${art}" alt="" draggable="false">
                    </div>`;
                } else {
                    tilesHtml += `<div class="${cls}" data-type="${type}" title="${tooltip}">
                        <div class="mat-tile-icon">${iconMarkup}</div>
                        <div class="mat-tile-level">${tile.level}</div>
                    </div>`;
                }
            });

            div.innerHTML = `
                <div class="mat-industry-label">${display.shortName} (${data.count})</div>
                <div class="mat-tiles">${tilesHtml}</div>
            `;
            container.appendChild(div);
        }
    }

    // A wooden cube in projection, matching the ones drawn on board tiles.
    cubeSvg(kind) {
        const tones = {
            coal: ['#4f4f4f', '#2e2e2e', '#1b1b1b'],
            iron: ['#f0983a', '#c06e1c', '#8d4e0e'],
            beer: ['#e8cf6a', '#b99a2c', '#866c16'],
        }[kind] || ['#8a8a8a', '#5f5f5f', '#444'];
        const [top, left, right] = tones;
        // 20x20 box: a squashed top diamond over two side faces.
        return `<svg class="cube-svg" viewBox="0 0 20 20" aria-hidden="true">
            <polygon points="10,2 18,6 10,10 2,6" fill="${top}"/>
            <polygon points="2,6 10,10 10,18 2,14" fill="${left}"/>
            <polygon points="18,6 10,10 10,18 18,14" fill="${right}"/>
        </svg>`;
    }

    updateMarkets() {
        // Coal market
        const coalTrack = document.getElementById('coal-track');
        coalTrack.innerHTML = '';
        const coalPrice = this.state.getCoalPrice();
        document.getElementById('coal-current-price').textContent =
            coalPrice === Infinity ? 'Empty' : `Price: £${coalPrice}`;

        for (let i = 0; i < COAL_MARKET_PRICES.length; i++) {
            const filled = i >= (COAL_MARKET_PRICES.length - this.state.coalMarket);
            const space = document.createElement('div');
            space.className = `market-space${filled ? ' filled coal' : ''}`;
            space.title = `£${COAL_MARKET_PRICES[i]}`;
            if (filled) space.innerHTML = this.cubeSvg('coal');
            else space.textContent = COAL_MARKET_PRICES[i];
            coalTrack.appendChild(space);
        }

        // Iron market
        const ironTrack = document.getElementById('iron-track');
        ironTrack.innerHTML = '';
        const ironPrice = this.state.getIronPrice();
        document.getElementById('iron-current-price').textContent =
            ironPrice === Infinity ? 'Empty' : `Price: £${ironPrice}`;

        for (let i = 0; i < IRON_MARKET_PRICES.length; i++) {
            const filled = i >= (IRON_MARKET_PRICES.length - this.state.ironMarket);
            const space = document.createElement('div');
            space.className = `market-space${filled ? ' filled iron' : ''}`;
            space.title = `£${IRON_MARKET_PRICES[i]}`;
            if (filled) space.innerHTML = this.cubeSvg('iron');
            else space.textContent = IRON_MARKET_PRICES[i];
            ironTrack.appendChild(space);
        }
    }

    // ========================================================================
    // Phase Bar
    // ========================================================================

    updatePhaseBar() {
        const bar = document.getElementById('action-phase-bar');
        const steps = bar.querySelectorAll('.phase-step');
        const instruction = document.getElementById('phase-instruction');

        if (!this.selectedAction) {
            bar.classList.add('hidden');
            return;
        }

        bar.classList.remove('hidden');

        // Determine which step we're on
        let currentStep = 1; // Choose Action
        let instructionText = 'Select an action';

        if (this.selectedAction && this.actionStep === 0) {
            currentStep = 2; // Select Target
            instructionText = this.getTargetInstruction();
        } else if (this.actionStep > 0) {
            currentStep = 3; // Discard Card
            if (this.selectedAction === ACTIONS.SCOUT) {
                const remaining = 3 - (this.pendingData.scoutCards?.length || 0);
                instructionText = `Select ${remaining} card${remaining !== 1 ? 's' : ''} to discard`;
            } else {
                instructionText = 'Click a card to discard';
            }
        }

        // Step labels follow the real order of prompts for each action.
        // Loan / Scout / Pass have no target step: only action -> discard.
        const noTarget = [ACTIONS.LOAN, ACTIONS.SCOUT, ACTIONS.PASS].includes(this.selectedAction);
        const targetLabel = {
            [ACTIONS.BUILD]: 'Choose Industry & Location', [ACTIONS.NETWORK]: 'Choose Link',
            [ACTIONS.DEVELOP]: 'Choose Tiles', [ACTIONS.SELL]: 'Choose Industries to Sell',
        }[this.selectedAction] || 'Select Target';
        const discardLabel = this.selectedAction === ACTIONS.SCOUT ? 'Discard 3 Cards' : 'Discard Card';
        const arrows = bar.querySelectorAll('.phase-step-arrow');
        if (noTarget && currentStep === 2) currentStep = 3;
        steps.forEach(step => {
            const n = parseInt(step.dataset.step);
            const lbl = step.querySelector('.phase-step-label');
            const want = n === 1 ? 'Choose Action' : n === 2 ? targetLabel : discardLabel;
            if (lbl && lbl.dataset.en !== want) { lbl.dataset.en = want; lbl.textContent = want; }
            const num = step.querySelector('.phase-step-num');
            if (num) num.textContent = (noTarget && n === 3) ? '2' : String(n);
            const hide = noTarget && n === 2;
            step.classList.toggle('hidden', hide);
            step.style.display = hide ? 'none' : '';
        });
        if (arrows[1]) { arrows[1].classList.toggle('hidden', noTarget); arrows[1].style.display = noTarget ? 'none' : ''; }

        steps.forEach(step => {
            const stepNum = parseInt(step.dataset.step);
            step.classList.remove('active', 'completed');
            if (stepNum < currentStep) {
                step.classList.add('completed');
            } else if (stepNum === currentStep) {
                step.classList.add('active');
            }
        });

        instruction.textContent = instructionText;
    }

    getTargetInstruction() {
        switch (this.selectedAction) {
            case ACTIONS.BUILD:
                if (!this.pendingData.buildIndustry) return 'Choose which industry to build';
                if (!this.pendingData.buildChoice) return 'Tap a glowing slot on the board or pick from the list';
                return 'Confirm the location';
            case ACTIONS.NETWORK: return 'Select a connection to build';
            case ACTIONS.DEVELOP: return 'Select a tile to develop';
            case ACTIONS.SELL: return 'Select industries to sell';
            case ACTIONS.LOAN: return 'Select a card to discard for £30 loan';
            case ACTIONS.SCOUT: return 'Select 3 cards to discard';
            case ACTIONS.PASS: return 'Select a card to discard';
            default: return '';
        }
    }

    // ========================================================================
    // Game Log
    // ========================================================================

    addLogEntry(playerId, message, type = 'action') {
        const entry = {
            playerId,
            message,
            type,
            timestamp: Date.now(),
        };

        this.gameLog.unshift(entry); // Newest first
        if (this.gameLog.length > 100) this.gameLog.pop();
        this.renderLog();
    }

    renderLog() {
        const container = document.getElementById('game-log');
        if (!container) return;

        container.innerHTML = '';

        for (const entry of this.gameLog) {
            const div = document.createElement('div');
            div.className = 'log-entry';

            if (entry.type === 'system') {
                div.classList.add('log-system');
                div.textContent = entry.message;
            } else if (entry.type === 'era') {
                div.classList.add('log-era');
                div.textContent = entry.message;
            } else {
                const player = entry.playerId !== null ? this.state.players[entry.playerId] : null;
                if (player) {
                    div.innerHTML = `<span class="log-player" style="color:${player.color}">${player.name}</span> ${entry.message}`;
                } else {
                    div.textContent = entry.message;
                }
            }

            container.appendChild(div);
        }
    }

    // ========================================================================
    // Turn Transition
    // ========================================================================

    showTurnTransition(player) {
        const overlay = document.getElementById('turn-transition');
        const nameEl = document.getElementById('turn-transition-name');
        const subtitleEl = document.querySelector('.turn-transition-subtitle');

        nameEl.textContent = player.name;
        nameEl.style.color = player.color;
        if (subtitleEl) subtitleEl.textContent = player.id === this.myId ? 'Your Turn'
            : (player.isAI ? 'AI Turn' : "Opponent's Turn");

        overlay.classList.remove('hidden', 'fade-out');

        // Auto-dismiss after 1.5s. Cancel timers from a previous transition so
        // rapid turn changes (AI turns) cannot hide/fade the new one early.
        clearTimeout(this._ttFade); clearTimeout(this._ttHide);
        this._ttFade = setTimeout(() => {
            overlay.classList.add('fade-out');
            this._ttHide = setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('fade-out');
            }, 500);
        }, 1000);
    }

    // ========================================================================
    // Card Selection
    // ========================================================================

    onCardClicked(index) {
        if (!this.isMyTurn()) return;
        if (this.selectedCard === index) {
            this.selectedCard = null;
        } else {
            this.selectedCard = index;
        }
        this.updateHand();

        // If we have an action selected and this was a card selection step
        if (this.selectedAction && this.actionStep > 0) {
            this.processActionStep();
        }
    }

    // ========================================================================
    // Action Selection
    // ========================================================================

    onActionSelected(action) {
        if (!this.isMyTurn()) return;
        if (this.selectedAction === action) {
            this.cancelAction();
            return;
        }

        this.selectedAction = action;
        this.actionStep = 0;
        this.pendingData = {};
        this.selectedCard = null;

        this.updateActionButtons();
        this.updatePhaseBar();
        this.startAction(action);
    }

    cancelAction() {
        this.selectedAction = null;
        this.actionStep = 0;
        this.pendingData = {};
        this.selectedCard = null;
        this.renderer.clearHighlights();
        this.hideLinkPicker();
        this.hideBuildPanel();
        this.updateActionButtons();
        this.updateHand();
        this.updatePhaseBar();
        this.closeModal();
    }

    // ========================================================================
    // Action Execution
    // ========================================================================

    startAction(action) {
        const playerId = this.state.currentPlayerId;

        switch (action) {
            case ACTIONS.BUILD:
                this.startBuild(playerId);
                break;
            case ACTIONS.NETWORK:
                this.startNetwork(playerId);
                break;
            case ACTIONS.DEVELOP:
                this.startDevelop(playerId);
                break;
            case ACTIONS.SELL:
                this.startSell(playerId);
                break;
            case ACTIONS.LOAN:
                this.startLoan(playerId);
                break;
            case ACTIONS.SCOUT:
                this.startScout(playerId);
                break;
            case ACTIONS.PASS:
                this.startPass(playerId);
                break;
        }
    }

    // ========================================================================
    // BUILD
    // ========================================================================

    startBuild(playerId) {
        const targets = this.logic.getValidBuildTargets(playerId);
        if (targets.length === 0) {
            this.showToast('No valid build targets available', 'warning');
            this.cancelAction();
            return;
        }
        this.pendingData.buildTargets = targets;
        this.pendingData.buildIndustry = null;
        const types = [...new Set(targets.map(t => t.industryType))];
        if (types.length === 1) this.chooseBuildIndustry(types[0]);
        else this.showBuildIndustryPicker(targets);
    }

    // ---- helpers for the build flow (localised directly; panel is data-no-i18n)
    bzh() { return !window.I18N || window.I18N.lang() === 'zh'; }
    bL(zh, en) { return this.bzh() ? zh : en; }
    bTown(id) {
        const n = CITIES[id]?.name || BREWERY_FARMS[id]?.name || id;
        if (BREWERY_FARMS[id]) return this.bL(id === 'northern' ? '北方農場酒廠' : '南方農場酒廠', n);
        return window.I18N ? window.I18N.townLabel(n) : n;
    }
    bInd(type) {
        const n = INDUSTRY_DISPLAY[type]?.name || type;
        return window.I18N ? window.I18N.t(n) : n;
    }
    bCost(t) {
        const parts = [`£${t.cost.total}`];
        if (t.cost.coal > 0) parts.push(this.bL(`需煤 ${t.cost.coal}`, `${t.cost.coal} coal`));
        if (t.cost.iron > 0) parts.push(this.bL(`需鐵 ${t.cost.iron}`, `${t.cost.iron} iron`));
        return parts.join(' · ');
    }
    bEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

    getBuildPanel() {
        let p = document.getElementById('build-panel');
        if (!p) {
            p = document.createElement('div');
            p.id = 'build-panel';
            p.setAttribute('data-no-i18n', '');
            (document.getElementById('game-screen') || document.body).appendChild(p);
        }
        p.classList.remove('hidden');
        document.getElementById('game-screen')?.classList.add('build-picking');
        return p;
    }

    hideBuildPanel() {
        const p = document.getElementById('build-panel');
        if (p) { p.classList.add('hidden'); p.innerHTML = ''; }
        document.getElementById('game-screen')?.classList.remove('build-picking');
        this.renderer.svg?.classList.remove('build-select-mode');
    }

    showBuildIndustryPicker(targets) {
        this.renderer.clearHighlights();
        this.renderer.svg?.classList.remove('build-select-mode');
        const byType = {};
        for (const t of targets) (byType[t.industryType] = byType[t.industryType] || []).push(t);
        let html = `<div class="bp-head"><span class="bp-title">${this.bL('要建造哪一種產業？', 'Which industry?')}</span>
            <button class="bp-cancel btn-small" data-bp="cancel">${this.bL('取消', 'Cancel')}</button></div><div class="bp-industries">`;
        for (const [type, ts] of Object.entries(byType)) {
            const towns = new Set(ts.map(t => t.cityId)).size;
            const minCost = Math.min(...ts.map(t => t.cost.total));
            html += `<button class="bp-industry" data-type="${type}">
                <span class="bp-ind-icon">${INDUSTRY_DISPLAY[type]?.icon || ''}</span>
                <span class="bp-ind-name">${this.bEsc(this.bInd(type))} ${this.bL('等級', 'Lv')}${ts[0].tileData.level}</span>
                <span class="bp-ind-meta">${this.bL(`${towns} 個城鎮 · £${minCost} 起`, `${towns} towns · from £${minCost}`)}</span></button>`;
        }
        html += '</div>';
        const p = this.getBuildPanel();
        p.className = 'bp-step-industry';
        p.innerHTML = html;
        p.querySelector('[data-bp="cancel"]').addEventListener('click', () => this.cancelAction());
        p.querySelectorAll('.bp-industry').forEach(b => b.addEventListener('click', () => this.chooseBuildIndustry(b.dataset.type)));
        this.updatePhaseBar();
    }

    chooseBuildIndustry(type) {
        this.pendingData.buildIndustry = type;
        this.pendingData.buildChoice = null;
        const ts = this.pendingData.buildTargets.filter(t => t.industryType === type);
        this.renderer.highlightSlots(ts);
        this.renderer.showBuildFocus?.(ts);
        this.renderer.svg?.classList.add('build-select-mode');
        this.showBuildSlotList(ts);
        this.updatePhaseBar();
    }

    // Grouped-by-town slot list; towns in my network / with a location card first.
    showBuildSlotList(ts) {
        const pid = this.state.currentPlayerId;
        const me = this.state.players[pid];
        const hasLoc = id => (me?.hand || []).some(c => c.location === id);
        const groups = {};
        for (const t of ts) (groups[t.cityId] = groups[t.cityId] || []).push(t);
        const rank = id => (this.state.isInNetwork && this.state.isInNetwork(pid, id) ? 2 : 0) + (hasLoc(id) ? 1 : 0);
        const ids = Object.keys(groups).sort((a, b) => rank(b) - rank(a) || this.bTown(a).localeCompare(this.bTown(b)));
        const multi = new Set(this.pendingData.buildTargets.map(t => t.industryType)).size > 1;
        let html = `<div class="bp-head"><span class="bp-title">${this.bL(`選擇 ${this.bEsc(this.bInd(ts[0].industryType))} 的位置`, `Where to build ${this.bEsc(this.bInd(ts[0].industryType))}?`)}</span>
            ${multi ? `<button class="btn-small" data-bp="back">${this.bL('換產業', 'Change')}</button>` : ''}
            <button class="bp-cancel btn-small" data-bp="cancel">${this.bL('取消', 'Cancel')}</button></div>
            <div class="bp-hint">${this.bL('點地圖上發光的格子，或從下方清單選擇', 'Tap a glowing slot on the board, or pick below')}</div><div class="bp-groups">`;
        for (const id of ids) {
            const r = rank(id);
            const tag = r >= 2 ? this.bL('在你的網路', 'in network') : r === 1 ? this.bL('有地點牌', 'location card') : '';
            html += `<div class="bp-town" data-city="${id}"><div class="bp-town-name">${this.bEsc(this.bTown(id))}${tag ? ` <span class="bp-tag">${tag}</span>` : ''}</div>`;
            for (const t of groups[id].sort((a, b) => a.slotIndex - b.slotIndex)) {
                const allowed = CITIES[id] ? [].concat(CITIES[id].slots[t.slotIndex]) : [INDUSTRY_TYPES.BREWERY];
                const ex = this.bExisting(t);
                const over = ex ? (ex.playerId === pid ? this.bL('⚠ 覆蓋自己的板塊', '⚠ overbuilds your tile') : this.bL('⚠ 覆蓋對手板塊', '⚠ overbuilds opponent')) : '';
                html += `<button class="bp-slot${ex ? ' bp-over' : ''}" data-city="${id}" data-slot="${t.slotIndex}">
                    <span class="bp-slot-name">${this.bL(`第 ${t.slotIndex + 1} 格（可蓋：${allowed.map(a => this.bEsc(this.bInd(a))).join('／')}）`, `Slot ${t.slotIndex + 1} (${allowed.map(a => this.bEsc(this.bInd(a))).join(' / ')})`)}</span>
                    <span class="bp-slot-cost">${this.bCost(t)}</span>${over ? `<span class="bp-over-tag">${over}</span>` : ''}</button>`;
            }
            html += '</div>';
        }
        html += '</div>';
        const p = this.getBuildPanel();
        p.className = 'bp-step-slot';
        p.innerHTML = html;
        p.querySelector('[data-bp="cancel"]').addEventListener('click', () => this.cancelAction());
        p.querySelector('[data-bp="back"]')?.addEventListener('click', () => { this.pendingData.buildIndustry = null; this.showBuildIndustryPicker(this.pendingData.buildTargets); });
        p.querySelectorAll('.bp-slot').forEach(b => b.addEventListener('click', () =>
            this.selectBuildSlot(b.dataset.city, parseInt(b.dataset.slot))));
    }

    bExisting(t) {
        return BREWERY_FARMS[t.cityId] ? this.state.breweryFarmTiles?.[t.cityId] : this.state.boardIndustries?.[`${t.cityId}_${t.slotIndex}`];
    }

    selectBuildSlot(cityId, slotIndex) {
        const type = this.pendingData.buildIndustry;
        const t = (this.pendingData.buildTargets || []).find(x => x.cityId === cityId && x.slotIndex === slotIndex && x.industryType === type);
        if (!t) return;
        this.pendingData.buildChoice = t;
        this.renderer.highlightSlots([t]);
        this.renderer.markChosenSlot?.(t);
        this.renderer.showBuildFocus?.([t], t);
        this.renderer.focusOn?.(cityId);
        const ex = this.bExisting(t);
        const over = ex ? this.bL('（覆蓋原有板塊）', ' (overbuild)') : '';
        const msg = this.bL(`在 〈${this.bEsc(this.bTown(cityId))}〉 第 ${slotIndex + 1} 格 建造 〈${this.bEsc(this.bInd(type))} 等級${t.tileData.level}〉，費用 £${t.cost.total}，使用煤 ${t.cost.coal}／鐵 ${t.cost.iron}${over}`,
            `Build ${this.bEsc(this.bInd(type))} Lv${t.tileData.level} in ${this.bEsc(this.bTown(cityId))} slot ${slotIndex + 1}, cost £${t.cost.total}, coal ${t.cost.coal} / iron ${t.cost.iron}${over}`);
        const p = this.getBuildPanel();
        p.className = 'bp-step-confirm';
        p.innerHTML = `<div class="bp-confirm"><span class="bp-confirm-text">${msg}</span>
            <span class="bp-confirm-btns"><button class="btn-primary btn-small" data-bp="ok">${this.bL('確認', 'Confirm')}</button>
            <button class="btn-small" data-bp="no">${this.bL('取消', 'Cancel')}</button></span></div>`;
        p.querySelector('[data-bp="ok"]').addEventListener('click', () => this.confirmBuildSlot());
        p.querySelector('[data-bp="no"]').addEventListener('click', () => this.chooseBuildIndustry(type));
    }

    confirmBuildSlot() {
        const t = this.pendingData.buildChoice;
        if (!t) return;
        this.pendingData = { cityId: t.cityId, slotIndex: t.slotIndex, industryType: t.industryType };
        this.hideBuildPanel();
        this.renderer.clearHighlights();
        this.actionStep = 1;
        this.updatePhaseBar();
        this.updateHand();
    }

    // Legacy entry point (kept for callers): now opens the grouped slot list.
    showBuildModal(playerId, targets) {
        if (!this.pendingData.buildTargets) this.pendingData.buildTargets = targets;
        this.chooseBuildIndustry(this.pendingData.buildIndustry || targets[0].industryType);
    }

    // ========================================================================
    // NETWORK
    // ========================================================================

    startNetwork(playerId) {
        const targets = this.logic.getValidNetworkTargets(playerId);
        if (targets.length === 0) {
            this.showToast('No valid network targets', 'warning');
            this.cancelAction();
            return;
        }

        this.renderer.highlightConnections(targets.map(t => t.connectionId));
        this.networkTargets = targets;
        this.showLinkPicker(targets);
    }

    // Non-modal picker: the map stays tappable (pulsing legal links); a tap
    // shows a confirmation line with both town names and the cost.
    linkTownName(id) {
        const en = CITIES[id]?.name || MERCHANTS[id]?.name || id;
        const zh = (typeof I18N !== 'undefined' && I18N.zhName) ? I18N.zhName(en) : en;
        return zh === en ? en : `${zh} ${en}`;
    }

    showLinkPicker(targets) {
        this.hideLinkPicker();
        const box = document.createElement('div');
        box.id = 'link-picker';
        const typeZh = t => t === 'canal' ? '運河' : '鐵路';
        let list = '';
        for (const t of targets) {
            list += `<button class="link-pick-item" data-conn="${t.connectionId}">${this.linkTownName(t.cities[0])} — ${this.linkTownName(t.cities[1])} <span>${typeZh(t.type)} £${t.cost}</span></button>`;
        }
        box.innerHTML = `<div class="link-pick-hint">點選地圖上<b>閃爍的金色連線</b>來建造（共 ${targets.length} 條可選）</div>
            <div class="link-pick-confirm hidden"><div class="link-pick-text"></div>
              <button class="link-pick-ok">確認建造</button><button class="link-pick-no">重選</button></div>
            <details class="link-pick-list"><summary>或從清單選擇</summary>${list}</details>`;
        const host = document.getElementById('board-container');
        // On phones the picker sits under the board so it never hides the links.
        if (host && (typeof innerWidth === 'number' ? innerWidth : 1200) <= 760) { box.classList.add('below-board'); host.after(box); }
        else (host || document.body).appendChild(box);
        box.querySelectorAll('.link-pick-item').forEach(b => b.addEventListener('click', () => this.previewLink(b.dataset.conn)));
        box.querySelector('.link-pick-no').addEventListener('click', () => {
            box.querySelector('.link-pick-confirm').classList.add('hidden');
            this.renderer.highlightConnections(targets.map(t => t.connectionId));
        });
        box.querySelector('.link-pick-ok').addEventListener('click', () => {
            const id = box.dataset.selected;
            if (id) { this.hideLinkPicker(); this.afterNetworkFirstSelection(id); }
        });
    }

    previewLink(connId) {
        const box = document.getElementById('link-picker');
        const t = (this.networkTargets || []).find(x => x.connectionId === connId);
        if (!box || !t) return;
        box.dataset.selected = connId;
        const typeZh = t.type === 'canal' ? '運河' : '鐵路';
        box.querySelector('.link-pick-text').textContent =
            `${this.linkTownName(t.cities[0])} ⇄ ${this.linkTownName(t.cities[1])}｜${typeZh}｜費用 £${t.cost}`;
        box.querySelector('.link-pick-confirm').classList.remove('hidden');
        this.renderer.svg.querySelectorAll('.connection-line.chosen-link').forEach(e => e.classList.remove('chosen-link'));
        this.renderer.svg.querySelectorAll(`[data-connection="${connId}"]`).forEach(e => e.classList.add('chosen-link'));
    }

    hideLinkPicker() {
        document.getElementById('link-picker')?.remove();
        this.renderer?.svg?.querySelectorAll('.chosen-link').forEach(e => e.classList.remove('chosen-link'));
    }

    // In the Rail Era a second link may be added (£15 total, +1 coal, +1 beer
    // from a brewery). Offer the option after the first link is chosen.
    afterNetworkFirstSelection(connectionId) {
        const playerId = this.state.currentPlayerId;

        if (this.state.era === ERA.RAIL) {
            const seconds = this.logic.getValidSecondRailLinks(playerId, connectionId);
            if (seconds.length > 0) {
                this.showSecondRailModal(connectionId, seconds);
                return;
            }
        }

        this.pendingData = { connectionId };
        this.renderer.clearHighlights();
        this.closeModal();
        this.actionStep = 1;
        this.updatePhaseBar();
        this.updateHand();
    }

    showSecondRailModal(firstConnId, seconds) {
        const name = id => CITIES[id]?.name || MERCHANTS[id]?.name || id;

        let html = '<p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">' +
            'Optionally build a second rail link — £15 total for both links, plus 1 coal per link and 1 beer from a brewery.</p>';
        html += '<div class="choice-list">';
        html += '<div class="choice-item" data-conn="none"><div class="choice-item-text"><div class="choice-item-name">Just one link</div><div class="choice-item-detail">£5 + 1 coal</div></div></div>';
        for (const s of seconds) {
            html += `
                <div class="choice-item" data-conn="${s.connectionId}">
                    <div class="choice-item-icon">#</div>
                    <div class="choice-item-text">
                        <div class="choice-item-name">${name(s.cities[0])} — ${name(s.cities[1])}</div>
                        <div class="choice-item-detail">2nd link · +1 beer</div>
                    </div>
                    <div class="choice-item-cost">£15 total${s.coalCost > 0 ? ` + £${s.coalCost} coal` : ''}</div>
                </div>
            `;
        }
        html += '</div>';

        this.showModal('Second Rail Link?', html, () => {});

        document.querySelectorAll('#modal-body .choice-item').forEach(item => {
            item.addEventListener('click', () => {
                const conn2 = item.dataset.conn;
                this.pendingData = { connectionId: firstConnId };
                if (conn2 !== 'none') this.pendingData.connectionId2 = conn2;
                this.renderer.clearHighlights();
                this.closeModal();
                this.actionStep = 1;
                this.updatePhaseBar();
                this.updateHand();
            });
        });
    }

    // ========================================================================
    // DEVELOP
    // ========================================================================

    startDevelop(playerId) {
        const types = this.logic.getDevelopableTypes(playerId);
        if (types.length === 0) {
            this.showToast('Nothing to develop', 'warning');
            this.cancelAction();
            return;
        }

        let html = '<p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">Remove 1-2 tiles from your mat to access higher levels. Costs 1 iron per tile.</p>';
        html += '<div class="choice-list">';
        for (const t of types) {
            const display = INDUSTRY_DISPLAY[t.type];
            html += `
                <div class="choice-item" data-type="${t.type}">
                    <div class="choice-item-icon">${display.icon}</div>
                    <div class="choice-item-text">
                        <div class="choice-item-name">${display.name} Lv${t.level}</div>
                        <div class="choice-item-detail">Remove this tile</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';

        this.showModal('Develop (Select 1st tile)', html, () => {});

        document.querySelectorAll('#modal-body .choice-item').forEach(item => {
            item.addEventListener('click', () => {
                const type1 = item.dataset.type;
                this.pendingData.industryType1 = type1;
                this.showDevelopSecondChoice(playerId, type1);
            });
        });
    }

    // Options for the 2nd develop tile, computed as if the 1st tile were
    // already removed: for the same industry this is the tile *after* the one
    // just chosen (e.g. 鐵廠 Lv1 -> 鐵廠 Lv2), and it must itself be developable.
    getDevelopSecondOptions(playerId, firstType) {
        const player = this.state.players[playerId];
        const out = [];
        for (const [type, tiles] of Object.entries(player.industryTiles)) {
            const unused = tiles.filter(t => !t.used);
            const next = type === firstType ? unused[1] : unused[0];
            if (next && next.canDevelop) out.push({ type, tile: next, level: next.level });
        }
        return out;
    }

    showDevelopSecondChoice(playerId, firstType) {
        const remainingTypes = this.getDevelopSecondOptions(playerId, firstType);

        const ironSources = this.state.findIronSource(playerId);
        const canAffordTwo = ironSources.length >= 2;

        if (!canAffordTwo || remainingTypes.length === 0) {
            this.closeModal();
            this.actionStep = 1;
            this.updatePhaseBar();
            this.updateHand();
            return;
        }

        let html = '<p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">Optionally develop a second tile (costs another iron).</p>';
        html += '<div class="choice-list">';
        html += '<div class="choice-item" data-type="none"><div class="choice-item-text"><div class="choice-item-name">Done (develop 1 tile only)</div></div></div>';

        for (const t of remainingTypes) {
            const display = INDUSTRY_DISPLAY[t.type];
            html += `
                <div class="choice-item" data-type="${t.type}">
                    <div class="choice-item-icon">${display.icon}</div>
                    <div class="choice-item-text">
                        <div class="choice-item-name">${display.name} Lv${t.level}</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';

        this.showModal('Develop (Optional 2nd tile)', html, () => {});

        document.querySelectorAll('#modal-body .choice-item').forEach(item => {
            item.addEventListener('click', () => {
                const type2 = item.dataset.type;
                this.pendingData.industryType2 = type2 === 'none' ? null : type2;
                this.closeModal();
                this.actionStep = 1;
                this.updatePhaseBar();
                this.updateHand();
            });
        });
    }

    // ========================================================================
    // SELL
    // ========================================================================

    startSell(playerId) {
        const targets = this.logic.getValidSellTargets(playerId);
        if (targets.length === 0) {
            this.showToast('Nothing to sell', 'warning');
            this.cancelAction();
            return;
        }

        let html = '<p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">Select industries to sell (you may sell multiple in one action). Consuming a merchant\'s beer barrel grants that merchant\'s bonus.</p>';
        html += '<div class="choice-list">';
        for (const target of targets) {
            const display = INDUSTRY_DISPLAY[target.tile.type];
            const cityName = CITIES[target.cityId]?.name || target.cityId;
            const offerMerchantBeer = target.beerNeeded > 0 && target.merchantBeerAvailable;
            html += `
                <div class="choice-item" data-key="${target.key}" data-selected="false">
                    <div class="choice-item-icon">${display.icon}</div>
                    <div class="choice-item-text">
                        <div class="choice-item-name">${display.name} Lv${target.tile.tileData.level}</div>
                        <div class="choice-item-detail">${cityName} | VP: ${target.tile.tileData.vp} | Income: +${target.tile.tileData.income}
                        ${target.beerNeeded > 0 ? ` | Beer: ${target.beerNeeded}` : ''}</div>
                        ${offerMerchantBeer ? `
                        <label class="choice-item-detail" style="display:flex;align-items:center;gap:5px;margin-top:4px;cursor:pointer;">
                            <input type="checkbox" class="merchant-beer-cb" data-key="${target.key}" checked>
                            Use merchant beer (claim bonus)
                        </label>` : ''}
                    </div>
                </div>
            `;
        }
        html += '</div>';

        const footer = '<button class="modal-btn modal-btn-primary" id="confirm-sell">Sell Selected</button>';
        this.showModal('Sell Goods', html, null, footer);

        const selectedKeys = new Set();
        document.querySelectorAll('#modal-body .choice-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.merchant-beer-cb')) return; // checkbox toggle, not row select
                const key = item.dataset.key;
                if (selectedKeys.has(key)) {
                    selectedKeys.delete(key);
                    item.style.borderColor = '';
                } else {
                    selectedKeys.add(key);
                    item.style.borderColor = 'var(--accent-gold)';
                }
            });
        });

        document.getElementById('confirm-sell').addEventListener('click', () => {
            if (selectedKeys.size === 0) {
                this.showToast('Select at least one industry to sell', 'warning');
                return;
            }
            this.pendingData.sellPlan = [...selectedKeys].map(key => {
                const cb = document.querySelector(`.merchant-beer-cb[data-key="${key}"]`);
                return { key, useMerchantBeer: cb ? cb.checked : false };
            });
            this.closeModal();
            this.actionStep = 1;
            this.updatePhaseBar();
            this.updateHand();
        });
    }

    // ========================================================================
    // LOAN
    // ========================================================================

    startLoan(playerId) {
        this.actionStep = 1;
        this.updatePhaseBar();
        this.updateHand();
    }

    // ========================================================================
    // SCOUT
    // ========================================================================

    startScout(playerId) {
        this.pendingData.scoutCards = [];
        this.actionStep = 1;
        this.updatePhaseBar();
        this.updateHand();
    }

    // ========================================================================
    // PASS
    // ========================================================================

    startPass(playerId) {
        this.actionStep = 1;
        this.updatePhaseBar();
        this.updateHand();
    }

    // ========================================================================
    // Process multi-step action
    // ========================================================================

    processActionStep() {
        if (this.selectedCard === null || !this.isMyTurn()) return;
        const cardIndex = this.selectedCard;
        const action = this.selectedAction;

        if (action === ACTIONS.SCOUT) {
            if (!this.pendingData.scoutCards) this.pendingData.scoutCards = [];
            if (this.pendingData.scoutCards.includes(cardIndex)) {
                this.selectedCard = null;
                this.updateHand();
                return;
            }
            this.pendingData.scoutCards.push(cardIndex);
            if (this.pendingData.scoutCards.length < 3) {
                this.selectedCard = null;
                this.updatePhaseBar();
                this.updateHand();
                return;
            }
        }

        // Send ONE complete action to the server; it validates and applies it.
        const pendingData = { ...this.pendingData };
        delete pendingData.buildTargets;
        delete pendingData.buildIndustry;
        delete pendingData.buildChoice;
        this.sendAction({
            action,
            pendingData,
            cardIndex,
            scoutCards: action === ACTIONS.SCOUT ? pendingData.scoutCards : undefined,
        });
    }

    // Gloucester merchant bonus: the server asks; we pick a tile (or skip).
    showBonusModal() {
        const types = (this.pendingBonus && this.pendingBonus.types) || [];
        let html = '<p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">Merchant bonus: remove a tile from your mat for free (no iron cost), or skip.</p>';
        html += '<div class="choice-list">';
        html += '<div class="choice-item" data-type="skip"><div class="choice-item-text"><div class="choice-item-name">Skip bonus</div></div></div>';
        for (const t of types) {
            const display = INDUSTRY_DISPLAY[t.type];
            html += `
                <div class="choice-item" data-type="${t.type}">
                    <div class="choice-item-icon">${display.icon}</div>
                    <div class="choice-item-text">
                        <div class="choice-item-name">${display.name} Lv${t.level}</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';

        this.showModal('Free Develop (Merchant Bonus)', html, () => {});

        document.querySelectorAll('#modal-body .choice-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                this.closeModal();
                if (this.net) this.net.send({ type: 'bonus', industryType: type === 'skip' ? null : type });
            });
        });
    }

    setAIOverlay(active) {
        document.getElementById('game-screen').classList.toggle('ai-turn-active', active);
    }

    // ========================================================================
    // Board Click Handler
    // ========================================================================

    onBoardClick(e) {
        if (!this.isMyTurn()) return;
        const target = e.target.closest('.industry-slot, .connection-line, .brewery-farm, .merchant-group');
        if (!target) return;

        if (this.selectedAction === ACTIONS.BUILD && this.actionStep === 0) {
            if (!this.pendingData.buildIndustry) return; // choose the industry first
            const farm = target.closest('.brewery-farm');
            if (farm && farm.classList.contains('highlight-slot')) { this.selectBuildSlot(farm.dataset.farm, 0); return; }
            const slot = target.closest('.industry-slot');
            if (slot && slot.classList.contains('highlight-slot')) {
                this.selectBuildSlot(slot.dataset.city, parseInt(slot.dataset.slot));
            }
            return;
        }

        if (this.selectedAction === ACTIONS.NETWORK) {
            const line = target.closest('.connection-line');
            if (line && line.classList.contains('highlight')) {
                this.previewLink(line.dataset.connection);
            }
        }
    }

    // ========================================================================
    // Modal
    // ========================================================================

    showModal(title, bodyHtml, onClose, footerHtml = '') {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = bodyHtml;
        document.getElementById('modal-footer').innerHTML = footerHtml;
        document.getElementById('modal-overlay').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }

    // ========================================================================
    // Toast
    // ========================================================================

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ========================================================================
    // Scoring Display
    // ========================================================================

    showScoring(title, scores) {
        const overlay = document.getElementById('scoring-overlay');
        document.getElementById('scoring-title').textContent = title;

        let html = '<table class="scoring-table"><thead><tr><th>Player</th><th>Link VP</th><th>Industry VP</th><th>Total VP</th></tr></thead><tbody>';
        for (const s of scores) {
            const player = this.state.players[s.playerId];
            html += `<tr>
                <td style="color:${player.color}">${player.name}</td>
                <td>${s.linkVP}</td>
                <td>${s.industryVP}</td>
                <td class="total-row">${s.totalVP}</td>
            </tr>`;
        }
        html += '</tbody></table>';

        document.getElementById('scoring-details').innerHTML = html;
        overlay.classList.remove('hidden');

        const continueFromScoring = () => {
            overlay.classList.add('hidden');
            this.refresh();
        };
        document.getElementById('scoring-continue-btn').onclick = continueFromScoring;

        // In an all-AI (spectator) game there's no human to click Continue —
        // auto-dismiss after a brief pause so the game keeps progressing.
    }

    showGameOver(scores) {
        const overlay = document.getElementById('gameover-overlay');

        // Rulebook: ties broken by highest income level, then most money
        const sorted = [...this.state.players].sort((a, b) =>
            (b.vp - a.vp) ||
            (this.state.getIncomeLevel(b.id) - this.state.getIncomeLevel(a.id)) ||
            (b.money - a.money));

        let html = '<table class="scoring-table"><thead><tr><th>Rank</th><th>Player</th><th>VP</th><th>Income</th><th>Money</th></tr></thead><tbody>';
        sorted.forEach((p, i) => {
            html += `<tr${i === 0 ? ' class="total-row"' : ''}>
                <td>${i + 1}</td>
                <td style="color:${p.color}">${p.name}</td>
                <td>${p.vp}</td>
                <td>${this.state.getIncomeLevel(p.id)}</td>
                <td>£${p.money}</td>
            </tr>`;
        });
        html += '</tbody></table>';

        document.getElementById('final-scores').innerHTML = html;
        overlay.classList.remove('hidden');

        document.getElementById('new-game-btn').onclick = () => {
            window.location.href = window.location.pathname; // back to room creation
        };
    }
}
