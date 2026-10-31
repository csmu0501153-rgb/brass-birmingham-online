// ============================================================================
// Minimal i18n layer: 繁體中文 (default) / English.
// The game code keeps producing English strings; this layer translates text
// nodes and title/placeholder attributes as they appear in the DOM (via a
// MutationObserver). Language is stored in localStorage('brass-lang').
// ============================================================================
(function () {
    'use strict';
    const KEY = 'brass-lang';
    let lang = 'zh';
    try { lang = localStorage.getItem(KEY) || 'zh'; } catch (_) { /* ignore */ }
    if (lang !== 'zh' && lang !== 'en') lang = 'zh';

    // ---- Exact phrases ------------------------------------------------------
    const D = {
        // setup / room
        'Brass': 'Brass', 'Birmingham': 'Birmingham',
        'An Economic Strategy Game · 1770–1870': '經濟策略遊戲 · 1770–1870',
        'Number of Players': '玩家人數', 'Players': '玩家', 'Player Names': '玩家名稱',
        'Create Room': '建立房間',
        'Choose which industry to build': '選擇要建造的產業', 'Tap a glowing slot on the board or pick from the list': '點地圖上發光的格子，或從清單選擇', 'Confirm the location': '確認建造位置', 'Begin Game': '開始遊戲',
        'Human': '真人玩家', 'AI (Easy)': 'AI（簡單）', 'AI (Normal)': 'AI（普通）', 'AI (Hard)': 'AI（困難）',
        'Easy': '簡單', 'Normal': '普通', 'Hard': '困難',
        'Room created! Private links': '房間已建立！以下是每位玩家的私人連結',
        "Send each friend ONLY their own link. Don't share a link with others — anyone with a link can play that seat and see that hand.":
            '請只把「各自的連結」傳給對應的朋友，不要把連結分享給其他人——任何拿到連結的人都能操作該座位並看到那位玩家的手牌。',
        "Keep your own link too (bookmark it) — it's how you get back into the game.":
            '也請保存你自己的連結（加入書籤），斷線或重開瀏覽器時要用它回到遊戲。',
        'Copy': '複製', 'Copied!': '已複製！', 'Open': '開啟',
        'AI player (played by the server)': 'AI 玩家（由伺服器操作）',
        'At least one seat must be a human player': '至少要有一位真人玩家',
        'Could not create room': '無法建立房間',
        'Cannot join game': '無法加入遊戲', 'Invalid room link': '房間連結無效（可能已過期或伺服器重啟後遺失）',
        'Create a new room': '建立新房間',
        'Connecting…': '連線中…', 'Online': '已連線', 'Disconnected — reconnecting…': '連線中斷，重新連線中…',
        'Not connected — please wait': '尚未連線，請稍候',
        // top bar / phase bar
        'Canal Era': '運河時代', 'Rail Era': '鐵路時代', 'Round 1': '第 1 回合',
        'Your Turn': '輪到你了', 'AI Turn': 'AI 回合', "Opponent's Turn": '對手回合',
        'Your Turn — choose bonus': '輪到你：請選擇商人獎勵',
        'Game Over': '遊戲結束', 'Empty': '已空',
        'Choose Action': '選擇行動', 'Choose Industry & Location': '選擇工業與地點', 'Choose Link': '選擇連線', 'Choose Tiles': '選擇要發展的板塊', 'Choose Industries to Sell': '選擇要販售的工業', 'Discard 3 Cards': '棄三張牌', 'Select Target': '選擇目標', 'Discard Card': '棄一張牌',
        'Select an action to begin': '請選擇一個行動', 'Select an action': '請選擇一個行動',
        'Cancel': '取消', 'Click a card to discard': '點選一張手牌棄掉',
        'Select what to build from the list': '從清單選擇要建造的工業',
        'Select a connection to build': '選擇要建造的連線',
        'Select a tile to develop': '選擇要發展的板塊',
        'Select industries to sell': '選擇要販售的工業',
        'Select a card to discard for £30 loan': '棄一張牌以借款 £30',
        'Select 3 cards to discard': '選擇 3 張牌棄掉',
        'Select a card to discard': '選擇一張牌棄掉',
        // panels
        'Markets': '市場', 'Coal': '煤', 'Iron': '鐵', 'Coal:': '煤：', 'Iron:': '鐵：', 'FREE DEVELOP': '免費發展', 'Game Log': '遊戲紀錄',
        'Your Hand': '你的手牌', 'Actions': '行動', 'Your Industries': '你的工業板塊',
        'Money': '金錢', 'Income level': '收入等級', 'Cards': '手牌數', 'Links': '剩餘連線',
        'VP': '勝利點', 'You': '你', 'Offline': '離線', 'Zoom in': '放大', 'Zoom out': '縮小', 'Fit board': '整張地圖', 'Acting': '行動中', 'Waiting': '等待中', 'AI': 'AI',
        // actions
        'Build': '建造', 'Network': '連線', 'Develop': '發展', 'Sell': '販售',
        'Loan': '借款', 'Scout': '偵察', 'Pass': '跳過',
        'Build an industry tile': '建造一個工業板塊', 'Build a canal or rail link': '建造運河或鐵路連線',
        'Remove lower-level tiles': '移除低等級板塊', 'Sell cotton, goods, or pottery': '販售棉花、商品或陶器',
        'Take a £30 loan': '借款 £30', 'Trade 3 cards for 2 wild cards': '棄 3 張牌換 2 張萬用牌',
        'Pass (discard a card)': '跳過（棄一張牌）', 'Cannot perform this action': '目前無法執行此行動',
        'Waiting for other players': '等待其他玩家',
        // disabled reasons
        'Hand is empty': '手牌已空', 'No valid build locations': '沒有可建造的位置',
        'No canal links remaining': '運河連線已用完', 'No rail links remaining': '鐵路連線已用完',
        'No valid connections available': '沒有可建造的連線', 'No iron available': '沒有可用的鐵',
        'No developable tiles on your mat': '玩家板上沒有可發展的板塊',
        'No industries ready to sell': '沒有可販售的工業',
        'Income too low — a loan cannot drop it below -10': '收入太低：借款不能讓收入低於 -10',
        'Need at least 3 cards': '至少需要 3 張手牌', 'Already have wild cards': '已持有萬用牌',
        'No wild cards available': '萬用牌已用完', 'Unknown action': '未知的行動',
        // industries
        'Cotton Mill': '棉紡廠', 'Coal Mine': '煤礦', 'Iron Works': '鐵廠', 'Manufacturer': '製造商',
        'Pottery': '陶器廠', 'Brewery': '啤酒廠', 'Cotton Mill / Manufacturer': '棉紡廠 / 製造商',
        'Cotton': '棉', 'Goods': '商品', 'Beer': '啤酒', 'ANY': '任意',
        'Brewery (N)': '啤酒廠（北）', 'Brewery (S)': '啤酒廠（南）',
        // cards
        'Location': '地點', 'Industry': '工業', 'Wild': '萬用', 'Wild Location': '萬用地點', 'Wild Industry': '萬用工業',
        // modals
        'Build Industry': '建造工業', 'Build Link': '建造連線', 'Second Rail Link?': '要建第二條鐵路嗎？',
        'Just one link': '只建一條', 'canal': '運河', 'rail': '鐵路',
        'Optionally build a second rail link — £15 total for both links, plus 1 coal per link and 1 beer from a brewery.':
            '可選擇再建第二條鐵路：兩條共 £15，每條另需 1 煤，並需從啤酒廠消耗 1 啤酒。',
        'Develop (Select 1st tile)': '發展（選擇第 1 個板塊）', 'Develop (Optional 2nd tile)': '發展（可選第 2 個板塊）',
        'Remove 1-2 tiles from your mat to access higher levels. Costs 1 iron per tile.':
            '從玩家板移除 1–2 個板塊以解鎖更高等級，每個板塊需 1 鐵。',
        'Remove this tile': '移除此板塊', 'Done (develop 1 tile only)': '完成（只發展 1 個）',
        'Optionally develop a second tile (costs another iron).': '可選擇再發展第二個板塊（再花 1 鐵）。',
        'Sell Goods': '販售貨物', 'Sell Selected': '販售所選',
        "Select industries to sell (you may sell multiple in one action). Consuming a merchant's beer barrel grants that merchant's bonus.":
            '選擇要販售的工業（一次行動可賣多個）。使用商人的啤酒桶可獲得該商人的獎勵。',
        'Use merchant beer (claim bonus)': '使用商人啤酒（領取獎勵）',
        'Select at least one industry to sell': '請至少選擇一個要販售的工業',
        'No valid build targets available': '沒有可建造的目標', 'No valid network targets': '沒有可建造的連線',
        'Nothing to develop': '沒有可發展的板塊', 'Nothing to sell': '沒有可販售的工業',
        'Free Develop (Merchant Bonus)': '免費發展（商人獎勵）', 'Skip bonus': '放棄獎勵',
        'Merchant bonus: remove a tile from your mat for free (no iron cost), or skip.':
            '商人獎勵：可免費（不需鐵）從玩家板移除一個板塊，或放棄。',
        // scoring
        'Era Scoring': '時代計分', 'Canal Era Complete': '運河時代結束', 'Continue': '繼續',
        'Player': '玩家', 'Link VP': '連線勝利點', 'Industry VP': '工業勝利點', 'Total VP': '總勝利點',
        'Rank': '名次', 'Income': '收入', 'New Game': '新遊戲',
        'Canal Era Scoring': '運河時代計分', 'Final Scoring': '最終計分',
        // server results / errors
        'Passed': '已跳過', 'Scouted: gained Wild Location + Wild Industry': '偵察：獲得萬用地點牌 + 萬用工業牌',
        'Not your turn': '還沒輪到你', 'Game is over': '遊戲已結束',
        'Waiting for merchant bonus choice': '正在等待商人獎勵的選擇',
        'Invalid build target': '無效的建造目標', 'That card cannot be used for this build': '這張牌不能用於此建造',
        'Invalid connection': '無效的連線', 'Invalid second link': '無效的第二條連線', 'Invalid card': '無效的手牌',
        'Cannot develop that industry': '無法發展該工業', 'Invalid sell plan': '無效的販售選擇',
        'Must discard exactly 3 cards': '必須剛好棄 3 張牌', 'Cannot scout': '無法偵察',
        'Action not allowed': '不允許此行動', 'Invalid action': '無效的行動', 'Bad message': '訊息格式錯誤',
        'Unknown message': '未知訊息', 'Bonus applied': '已套用獎勵', 'Bonus resolved': '獎勵已處理',
        'No bonus pending': '目前沒有待處理的獎勵',
        'Cannot afford this build': '錢不夠建造', 'No tile available': '沒有可用板塊',
        'Double links are Rail Era only': '雙連線只能在鐵路時代建造', 'Not enough rail links': '鐵路連線不足',
        'Connection already built': '此連線已被建造', 'Not enough iron available': '鐵不足',
        'Cannot afford market iron': '買不起市場上的鐵', 'Nothing could be sold': '沒有東西能賣出',
        'A loan cannot take your income below -10': '借款不能讓收入低於 -10',
        'passed': '跳過', 'scouted (gained wild cards)': '偵察（獲得萬用牌）', 'took £30 loan': '借款 £30',
        'Canal & Rail': '運河與鐵路時代', 'Canal only': '僅運河時代', 'Rail only': '僅鐵路時代',
        'Used': '已使用', 'Available': '可用',
        'Cannot afford both links': '錢不夠建造兩條連線', 'Cannot develop that second tile': '無法發展第二個板塊',
        'First link is not adjacent to your network': '第一條連線未與你的網路相鄰',
        'Second link is not adjacent to your network': '第二條連線未與你的網路相鄰',
        'No beer available for the second link': '第二條連線沒有可用的啤酒',
        'No coal for first link': '第一條連線沒有可用的煤', 'No coal for second link': '第二條連線沒有可用的煤',
    };

    const IND = [
        ['Cotton Mill / Manufacturer', '棉紡廠 / 製造商'], ['Cotton Mill', '棉紡廠'], ['Coal Mine', '煤礦'],
        ['Iron Works', '鐵廠'], ['Manufacturer', '製造商'], ['Pottery', '陶器廠'], ['Brewery', '啤酒廠'],
    ];
    const indName = s => { for (const [en, zh] of IND) s = s.split(en).join(zh); return s; };

    // ---- Pattern rules (whole string) ---------------------------------------
    const R = [
        [/^(.+)'s Turn$/, (m, n) => `${n} 的回合`],
        [/^(\d+) actions? left$/, (m, n) => `剩餘 ${n} 個行動`],
        [/^Round (\d+) \| Deck: (\d+)$/, (m, r, d) => `第 ${r} 回合 | 牌堆：${d}`],
        [/^Round (\d+)$/, (m, r) => `第 ${r} 回合`],
        [/^Price: £(\d+)$/, (m, p) => `價格：£${p}`],
        [/^(-?\d+) cds$/, (m, n) => `${n} 張`],
        [/^(-?\d+) lnk$/, (m, n) => `${n} 連線`],
        [/^Select (\d+) cards? to discard$/, (m, n) => `選擇 ${n} 張牌棄掉`],
        [/^(?![Ss]old )([A-Za-z /()]+) Lv(\d)$/, (m, a, l) => `${tr(a) || indName(a)} 等級${l}`],
        [/^(.+) \(Slot (\d+)\)$/, (m, c, n) => `${c}（第 ${n} 格）`],
        [/^(Cotton|Coal|Iron|Goods|Pottery|Beer) \((\d+)\)$/, (m, a, n) => `${tr(a)} (${n})`],
        [/^(.+)'s turn$/, (m, n) => `輪到 ${n}`],
        [/^\+(\d+) INCOME$/, (m, n) => `+${n} 收入`], [/^\+(\d+) VP$/, (m, n) => `+${n} 勝利點`],
        [/^Game started with (\d) players$/, (m, n) => `遊戲開始，共 ${n} 位玩家`],
        [/^CANAL ERA · (.+)$/, (m, y) => `運河時代 · ${y}`],
        [/^RAIL ERA · (.+)$/, (m, y) => `鐵路時代 · ${y}`],
        [/^Brass: Birmingham — (.+)$/, (m, n) => `Brass: Birmingham — ${n}`],
        [/^Took £(\d+) loan \(income -(\d+) levels\)$/, (m, a, l) => `借款 £${a}（收入下降 ${l} 級）`],
        [/^2nd link · \+1 beer$/, () => '第二條 · +1 啤酒'],
    ];

    // ---- Free-text fragments (log, toasts, tooltips, costs) -----------------
    const F = [
        [/^[Bb]uilt (canal|rail) link: /, (m, t) => `建造了${t === 'canal' ? '運河' : '鐵路'}連線：`],
        [/^[Bb]uilt 2 rail links: /, () => '建造了 2 條鐵路連線：'],
        // Sell lines must run before the generic ' Lv' rule.
        [/[Ss]old (.+?) Lv(\d)(?= for £)/g, (m, i, l) => `賣掉 ${indName(i)} 等級${l}`],
        [/[Ss]old (.+?) Lv(\d)/g, (m, i, l) => `賣出了 ${indName(i)} 等級${l}`],
        [/, (?=賣出了 )/g, () => '；'],
        [/ \[([^\]]+)\]/g, (m, inner) => `，獲得商人獎勵 ${inner.split('; ').join('、')}`],
        [/\+£(\d+) \((.+?)\)/g, (m, n, w) => `+£${n}（${w}）`],
        [/ Lv(\d)/g, (m, l) => ` 等級${l}`],
        [/ \(1 beer consumed\)/, () => '（消耗 1 啤酒）'],
        [/^[Bb]uilt (.+?) Level (\d) in (.+?)(?= —|$)/, (m, i, l, c) => `在 ${c} 建造了 ${indName(i)} 等級${l}`],
        [/ — auto-sold (\d+) (coal|iron) to market for £(\d+); market full, (\d+) left on tile/, (m, n, r, p, k) => `，自動賣出 ${n} 塊${r === 'coal' ? '煤' : '鐵'}，收 £${p}；市場已滿，板塊上還剩 ${k} 塊`],
        [/ — auto-sold (\d+) (coal|iron) to market for £(\d+) \(tile flipped! \+(\d+) income\)/, (m, n, r, p, i) => `，自動賣出 ${n} 塊${r === 'coal' ? '煤' : '鐵'}，收 £${p}（全部賣完，板塊翻面！收入 +${i}）`],
        [/ — auto-sold (\d+) (coal|iron) to market for £(\d+)/, (m, n, r, p) => `，自動賣出 ${n} 塊${r === 'coal' ? '煤' : '鐵'}，收 £${p}`],
        [/ — not connected to a merchant: 0 sold, all (\d+) coal stay on tile/, (m, k) => `，未連到商人，煤不會自動賣出：賣出 0 塊，${k} 塊煤全部留在板塊上`],
        [/ — (coal|iron) market full: 0 sold, all (\d+) (?:coal|iron) stay on tile/, (m, r, k) => `，${r === 'coal' ? '煤' : '鐵'}市場已滿：賣出 0 塊，${k} 塊${r === 'coal' ? '煤' : '鐵'}全部留在板塊上`],
        [/ — sold (\d+) to market for £(\d+)/, (m, n, p) => `，賣 ${n} 個到市場得 £${p}`],
        [/ \(tile flipped! \+(\d+) income\)/, (m, n) => `（板塊翻面！收入 +${n}）`],
        [/ \(tile flipped!\)/, () => '（板塊翻面！）'],
        [/ \((\d+) left on tile\)/, (m, n) => `（市場已滿，${n} 塊留在板塊上）`],
        [/ — not connected to a merchant, coal stays on tile/, () => '，未連到商人，煤留在板塊上（不會自動賣出）'],
        [/ — market full, cubes stay on tile/, () => '，市場已滿，方塊留在板塊上'],
        [/^[Dd]eveloped /, () => '發展了 '],
        [/[Ss]old (.+?) Lv(\d)/g, (m, i, l) => `賣出 ${indName(i)} 等級${l}`],
        [/free develop earned \((.+?)\)/g, (m, n) => `獲得免費發展（${n}）`],
        [/free develop: /g, () => '免費發展：'],
        [/\+(\d+) income spaces \((.+?)\)/g, (m, n, w) => `+${n} 收入格（${w}）`],
        [/\+(\d+) VP \((.+?)\)/g, (m, n, w) => `+${n} 勝利點（${w}）`],
        [/^used merchant bonus: developed /, () => '使用商人獎勵：發展了 '],
        [/^賣掉 (.+?) for £(\d+) to cover income shortfall/, (m, i, p) => `為補足收入缺口賣掉 ${i}，得 £${p}`],
        [/^could not pay income shortfall — lost (\d+) VP/, (m, n) => `無法支付收入缺口，失去 ${n} 勝利點`],
        [/ and /g, () => ' 與 '],
        [/(\d+) coal\b/g, (m, n) => `${n} 煤`], [/(\d+) iron\b/g, (m, n) => `${n} 鐵`],
        [/(\d+) beer\b/g, (m, n) => `${n} 啤酒`], [/£(\d+) total/g, (m, n) => `共 £${n}`],
        [/^Cost: /, () => '費用：'], [/^Flip: /, () => '翻面：'], [/^Era: /, () => '時代：'],
        [/ VP\b/g, () => ' 勝利點'], [/\+(\d+) Income/g, (m, n) => `+${n} 收入`],
        [/Sell: /g, () => '販售需：'], [/Produces: (\d+) cubes/g, (m, n) => `產出 ${n} 個方塊`],
        [/Cannot develop/g, () => '不可發展'], [/VP: /g, () => '勝利點：'], [/Income: /g, () => '收入：'],
        [/Beer: /g, () => '啤酒：'], [/\(Used\)/g, () => '（已使用）'], [/\(Available\)/g, () => '（可用）'],
    ];

    // ---- Town / merchant names: '伯明罕 Birmingham' (HTML text only; the
    // board SVG is left untouched). Idempotent thanks to the lookbehind.
    const TOWNS = {
        'Birmingham': '伯明罕', 'Coventry': '考文垂', 'Wolverhampton': '伍爾弗漢普頓', 'Dudley': '達德利',
        'Stoke-on-Trent': '斯托克', 'Burton-on-Trent': '伯頓', 'Tamworth': '塔姆沃思', 'Coalbrookdale': '煤溪谷',
        'Belper': '貝爾珀', 'Kidderminster': '基德明斯特', 'Worcester': '伍斯特', 'Redditch': '雷迪奇',
        'Walsall': '沃爾索爾', 'Nuneaton': '農尼頓', 'Leek': '利克', 'Uttoxeter': '尤托克西特',
        'Cannock': '坎諾克', 'Stafford': '斯塔福德', 'Derby': '德比', 'Nottingham': '諾丁漢',
        'Gloucester': '格洛斯特', 'Oxford': '牛津', 'Warrington': '沃靈頓', 'Shrewsbury': '什魯斯伯里',
        'Stone': '斯通',
    };
    const TOWN_RE = new RegExp(Object.keys(TOWNS).sort((a, b) => b.length - a.length)
        .map(n => `(?<!${TOWNS[n]} )(?<![A-Za-z-])${n.replace(/-/g, '\\-')}(?![A-Za-z-])`).join('|'), 'g');
    const townNames = s => s.replace(TOWN_RE, n => `${TOWNS[n]} ${n}`);
    const townLabel = n => (lang === 'zh' && TOWNS[n]) ? `${TOWNS[n]} ${n}` : n;

    function tr(s) {
        if (lang !== 'zh' || !s) return s;
        if (Object.prototype.hasOwnProperty.call(D, s)) return D[s];
        for (const [re, fn] of R) { const m = s.match(re); if (m) return fn(...m); }
        return null;
    }

    function trFree(s) {
        let out = s, hit = false;
        for (const [re, fn] of F) {
            const n = out.replace(re, (...a) => fn(...a));
            if (n !== out) { hit = true; out = n; }
        }
        return hit ? indName(out) : null;
    }

    function translateString(s, inSvg) {
        if (lang !== 'zh' || !s || !/[A-Za-z]/.test(s)) return null;
        const t0 = translateCore(s, inSvg);
        if (inSvg || /Brass/.test(s)) return t0;
        const base = t0 === null ? s : t0;
        const t1 = townNames(base);
        return t1 === s ? null : t1;
    }

    function translateCore(s, inSvg) {
        if (s.includes('\n')) {
            const lines = s.split('\n');
            const outs = lines.map(l => translateCore(l, inSvg));
            if (outs.every(o => o === null)) return null;
            return lines.map((l, i) => outs[i] === null ? l : outs[i]).join('\n');
        }
        const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
        const core = s.trim();
        if (!core) return null;
        let t = tr(core);
        if (t === null) t = trFree(core);
        if (t === null || t === core) return null;
        return lead + t + trail;
    }

    const ATTRS = ['title', 'placeholder', 'alt'];
    function translateNode(node) {
        if (node.nodeType === 3) {
            const p = node.parentNode;
            if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'TEXTAREA')) return;
            const inSvg = !!(p && p.closest && p.closest('svg'));
            const t = translateString(node.nodeValue, inSvg);
            if (t !== null && t !== node.nodeValue) node.nodeValue = t;
            return;
        }
        if (node.nodeType !== 1) return;
        if (node.hasAttribute('data-no-i18n')) return;
        translateAttrs(node);
        for (const c of node.childNodes) translateNode(c);
    }

    function translateAttrs(node) {
        if (node.nodeType !== 1 || !node.hasAttribute) return;
        for (const a of ATTRS) {
            if (node.hasAttribute && node.hasAttribute(a)) {
                const v = node.getAttribute(a);
                const t = translateString(v, !!(node.closest && node.closest('svg')));
                if (t !== null && t !== v) node.setAttribute(a, t);
            }
        }
    }

    function start() {
        document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
        if (lang === 'zh') {
            translateNode(document.body);
            const t = translateString(document.title);
            if (t) document.title = t;
            const obs = new MutationObserver(muts => {
                for (const m of muts) {
                    try {
                        if (m.type === 'characterData') translateNode(m.target);
                        else if (m.type === 'attributes') translateAttrs(m.target);
                        else m.addedNodes.forEach(translateNode);
                    } catch (e) { if (window.console) console.warn('i18n', e); }
                }
            });
            obs.observe(document.body, { subtree: true, childList: true, characterData: true,
                attributes: true, attributeFilter: ATTRS });
        }
        const btn = document.createElement('button');
        btn.className = 'lang-toggle';
        btn.setAttribute('data-no-i18n', '');
        btn.textContent = lang === 'zh' ? 'English' : '中文';
        btn.addEventListener('click', () => {
            try { localStorage.setItem(KEY, lang === 'zh' ? 'en' : 'zh'); } catch (_) { /* ignore */ }
            location.reload();
        });
        // main.js moves it into the top bar on the game screen.
        document.body.appendChild(btn);
    }

    window.I18N = { townLabel, TOWNS, zhName: n => TOWNS[n] || n, lang: () => lang, t: s => { const r = translateString(s); return r === null ? s : r; } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
