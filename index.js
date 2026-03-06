import { chromium } from 'playwright';
import axios from 'axios';

const EMAIL = process.env.FINVIA_EMAIL;
const PASSWORD = process.env.FINVIA_PASSWORD;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TOPIC_ID = 23338;

let isRunning = true;
let MIN_AMOUNT = 100000;
let MAX_AMOUNT = 10000000;
let RELOAD_INTERVAL = 800;
let staffTag = '@gehjUw';

let takenDeals = [];

let browser, page;
let lastUpdateId = 0;

async function sendTelegram(text, keyboard = null) {
    const params = { chat_id: CHAT_ID, message_thread_id: TOPIC_ID, text, parse_mode: 'HTML' };
    if (keyboard) params.reply_markup = JSON.stringify(keyboard);
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, params);
}

function showMenu() {
    const keyboard = {
        inline_keyboard: [
            [{ text: isRunning ? '⏹ ВЫКЛ' : '▶ ВКЛ', callback_data: isRunning ? 'off' : 'on' }],
            [{ text: '📊 Статус', callback_data: 'status' }],
            [{ text: '📈 Статистика', callback_data: 'stats' }],
            [
                { text: `Мин: ${MIN_AMOUNT/1000}k`, callback_data: 'min' },
                { text: `Рефреш: ${RELOAD_INTERVAL}мс`, callback_data: 'reload' }
            ],
            [{ text: `Сотрудник: ${staffTag}`, callback_data: 'staff' }]
        ]
    };
    sendTelegram(`<b>Управление ботом 24/7</b>\nСтатус: ${isRunning ? '✅ Работает' : '⏹ Выключен'}`, keyboard);
}

function getStats() {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const todayStart = new Date().setHours(0,0,0,0);

    let todayCount = 0, todaySum = 0;
    let hourCount = 0, hourSum = 0;
    let totalCount = takenDeals.length;
    let totalSum = takenDeals.reduce((a, d) => a + d.amount, 0);

    takenDeals.forEach(d => {
        if (d.timestamp >= todayStart) { todayCount++; todaySum += d.amount; }
        if (d.timestamp >= hourAgo) { hourCount++; hourSum += d.amount; }
    });

    return `📊 <b>Статистика</b>\n\nЗа сегодня: ${todayCount} заявок / ${todaySum.toLocaleString('ru-RU')} ARS\nЗа час: ${hourCount} заявок / ${hourSum.toLocaleString('ru-RU')} ARS\nВсего: ${totalCount} заявок / ${totalSum.toLocaleString('ru-RU')} ARS`;
}

async function login() {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();

    await page.goto('https://lk.finvia.trade/payouts/available', { waitUntil: 'networkidle' });

    await page.fill('input[placeholder="testclient4"], input[type="text"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button:has-text("Войти")');

    await page.waitForURL('**/payouts/available*', { timeout: 30000 });

    console.log('✅ Успешный вход');
    sendTelegram('🚀 Бот 24/7 запущен!\nНапиши /menu');
    setInterval(checkAndTake, RELOAD_INTERVAL);
}

async function checkAndTake() {
    if (!isRunning || !page) return;
    await page.reload();

    const rows = await page.locator('tbody tr').all();

    // Сортировка по сумме (от большей к меньшей)
    const sortedRows = [...rows].sort(async (a, b) => {
        const aText = await a.locator('td').nth(3).textContent();
        const bText = await b.locator('td').nth(3).textContent();
        const aAmount = Number(aText.match(/(\d{1,3}(?:\s*\d{3})*(?:[,.]\d+)?)/)?.[1]?.replace(/[\s,.]/g, '')) || 0;
        const bAmount = Number(bText.match(/(\d{1,3}(?:\s*\d{3})*(?:[,.]\d+)?)/)?.[1]?.replace(/[\s,.]/g, '')) || 0;
        return bAmount - aAmount;
    });

    for (const row of sortedRows) {
        const fiatText = await row.locator('td').nth(3).textContent();
        const match = fiatText.match(/(\d{1,3}(?:\s*\d{3})*(?:[,.]\d+)?)\s*ARS/i);
        if (!match) continue;

        const amount = Number(match[1].replace(/[\s,.]/g, ''));
        if (isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) continue;

        const button = row.locator('button:has-text("Взять в работу")').first();
        if (await button.isVisible()) {
            await button.click();

            setTimeout(async () => {
                const pageText = await page.innerText('body');
                const id = await row.locator('td').nth(0).textContent();
                const msg = `Взята заявка!\nID: ${id.trim()}\nFIAT: ${amount} ARS\n${staffTag}`;

                if (pageText.includes('Выплата добавлена')) {
                    await sendTelegram(msg);
                    takenDeals.push({ timestamp: Date.now(), amount });
                }
            }, 900);
            break;
        }
    }
}

// Обработка команд и кнопок
setInterval(async () => {
    try {
        const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=8`);
        const updates = res.data.result || [];

        for (const update of updates) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);

            if (update.message?.text === '/menu') showMenu();

            if (update.message?.text?.startsWith('/setuser')) {
                const newTag = update.message.text.split(' ')[1];
                if (newTag && newTag.startsWith('@')) {
                    staffTag = newTag;
                    await sendTelegram(`✅ Тег изменён на ${staffTag}`);
                }
            }

            if (update.message?.text === '/stats') await sendTelegram(getStats());

            if (update.callback_query) {
                const data = update.callback_query.data;
                if (data === 'on') isRunning = true;
                if (data === 'off') isRunning = false;
                if (data === 'stats') await sendTelegram(getStats());
                showMenu();
            }
        }
    } catch (e) {}
}, 8000);

// Запуск
login();
