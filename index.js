require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const { User, Deposit, Withdrawal, Transaction, OTP } = require('./models');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// ===================== MONGODB =====================
const mongoOpts = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  retryWrites: true,
};
mongoose.connect(process.env.MONGODB_URI, mongoOpts)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// Auto-reconnect on disconnect
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected — reconnecting...');
  setTimeout(() => mongoose.connect(process.env.MONGODB_URI, mongoOpts).catch(()=>{}), 3000);
});

// ===================== GMAIL OTP =====================
const GMAIL_USER = 'shankarswami2605@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  }
});

// Test mailer on startup
mailer.verify((err, success) => {
  if(err) console.error('❌ Mailer FAILED:', err.message);
  else console.log('✅ Mailer connected — emails will send');
});

async function sendAdminEmail(subject, htmlBody) {
  try {
    const info = await mailer.sendMail({
      from: `"BIG MONEY 💰" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject,
      html: htmlBody
    });
    console.log('✅ Admin email sent:', info.messageId);
  } catch (e) {
    console.error('❌ Admin email FAILED:', e.message);
  }
}

async function sendOTPEmail(toEmail, otp) {
  try {
    await mailer.sendMail({
      from: '"BIG MONEY 💰" <shankarswami2605@gmail.com>',
      to: toEmail,
      subject: `Your BIG MONEY OTP: ${otp}`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;background:#f0f2f8;padding:30px;border-radius:16px">
        <h2 style="color:#1a1aff;text-align:center;margin-bottom:4px">BIG <span style="color:#ffd700">MONEY</span></h2>
        <p style="text-align:center;color:#888;font-size:13px;margin-bottom:24px">💰 INVEST • EARN • GROW</p>
        <div style="background:#fff;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px">
          <p style="color:#555;margin-bottom:12px;font-size:15px">Your One-Time Password is:</p>
          <div style="background:#1a1aff;color:#fff;font-size:38px;font-weight:bold;padding:18px 10px;border-radius:12px;letter-spacing:10px">${otp}</div>
          <p style="color:#999;font-size:12px;margin-top:12px">⏰ Expires in 5 minutes</p>
        </div>
        <p style="color:#aaa;font-size:11px;text-align:center">Do not share this OTP with anyone. BIG MONEY will never ask for your OTP.</p>
      </div>`
    });
    return { success: true };
  } catch (e) {
    console.error('Gmail error:', e.message);
    return { success: false, error: e.message };
  }
}

// ===================== TELEGRAM DISABLED — EMAIL ONLY =====================
// Telegram bot removed to prevent server crashes
// All admin notifications now go via email only
console.log('✅ Running in email-only mode (Telegram disabled)');

// ===================== AUTH MIDDLEWARE =====================
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'No token' });
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET missing from env!');
      return res.status(500).json({ success: false, error: 'Server config error' });
    }
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id).lean();
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    req.user = user;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// notifyAdmin — email only (Telegram removed)
async function notifyAdmin(message, keyboard = null) {
  // Telegram disabled — log to console only
  console.log('📢 Admin notification:', message.substring(0, 100));
}

function generateUID() {
  return 'BM' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ===================== SEND OTP =====================
// Screen OTP — no SMS/email needed. OTP shown directly on app screen.
app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone, email } = req.body;
    const identifier = phone ? phone.trim() : email ? email.toLowerCase().trim() : null;
    if (!identifier) return res.json({ success: false, message: 'Phone number required' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // deleteMany timeout safe — fire and forget, don't block OTP generation
    OTP.deleteMany({ identifier }).catch(()=>{});
    await OTP.create({ identifier, otp });
    // Return OTP in response — displayed on screen directly (no SMS gateway needed)
    return res.json({ success: true, message: 'OTP generated!', devOtp: otp });
  } catch (e) {
    console.error('send-otp error:', e);
    res.json({ success: false, message: 'Server error. Try again.' });
  }
});

// ===================== REGISTER =====================
app.post('/api/register', async (req, res) => {
  try {
    const { phone, email, otp, password, refCode } = req.body;
    if (!phone || !otp || !password) return res.json({ success: false, message: 'Phone, OTP and password required' });
    if (password.length < 6) return res.json({ success: false, message: 'Password minimum 6 characters' });

    // Always use phone as OTP identifier (screen OTP system)
    const identifier = phone.trim();
    const otpDoc = await OTP.findOne({ identifier, otp: otp.toString() });
    if (!otpDoc) return res.json({ success: false, message: 'Invalid or expired OTP. Click Get OTP again.' });

    const existing = await User.findOne({ phone });
    if (existing) return res.json({ success: false, message: 'Account already exists with this phone' });

    const hashed = await bcrypt.hash(password, 10);
    let uid = generateUID();
    while (await User.findOne({ uid })) uid = generateUID();

    let refBy = null;
    if (refCode) {
      const referrer = await User.findOne({ refCode: refCode.toUpperCase() });
      if (referrer) {
        refBy = referrer.uid;
        await User.findByIdAndUpdate(referrer._id, { $inc: { refCount: 1 } });
        // Check milestone bonuses
        const newCount = (referrer.refCount || 0) + 1;
        let bonus = 0;
        if (newCount === 5) bonus = 2000;
        else if (newCount === 10) bonus = 7500;
        else if (newCount === 20) bonus = 24000;
        if (bonus > 0) {
          await User.findByIdAndUpdate(referrer._id, { $inc: { refBonus: bonus, earnings: bonus } });
          await Transaction.create({ userId: referrer._id, type: 'Referral Bonus', amount: bonus, note: `${newCount} members milestone` });
        }
      }
    }

    const user = await User.create({ phone, email: email || '', password: hashed, uid, refCode: uid, refBy });
    await OTP.deleteMany({ identifier });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { phone: user.phone, uid: user.uid, balance: 0, earnings: 0, refCode: uid, totalDeposit: 0, withdrawEligible: false, refFriendsDeposited: 0 } });
  } catch (e) {
    console.error('Register error:', e);
    res.json({ success: false, message: 'Registration failed. Try again.' });
  }
});

// ===================== LOGIN =====================
app.post('/api/login', async (req, res) => {
  try {
    const { phone, otp, password } = req.body;
    if (!phone || !password) return res.json({ success: false, message: 'Phone and password required' });

    const user = await User.findOne({ phone });
    if (!user) return res.json({ success: false, message: 'Account not found. Please register.' });

    // OTP check — required (screen OTP system)
    if (!otp) return res.json({ success: false, message: 'OTP required. Click Get OTP first.' });
    const otpDoc = await OTP.findOne({ identifier: phone.trim(), otp: otp.toString() });
    if (!otpDoc) return res.json({ success: false, message: 'Invalid or expired OTP. Click Get OTP again.' });
    await OTP.deleteMany({ identifier: phone.trim() });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false, message: 'Wrong password' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true, token,
      user: { phone: user.phone, uid: user.uid, balance: user.balance, earnings: user.earnings, refCode: user.refCode, totalDeposit: user.totalDeposit, withdrawEligible: user.withdrawEligible, refFriendsDeposited: user.refFriendsDeposited || 0 }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.json({ success: false, message: 'Login failed. Try again.' });
  }
});

// ===================== USER INFO =====================
app.get('/api/me', auth, async (req, res) => {
  const u = req.user;
  res.json({ success: true, user: { phone: u.phone, uid: u.uid, balance: u.balance, earnings: u.earnings, refCode: u.refCode, totalDeposit: u.totalDeposit, refCount: u.refCount, refBonus: u.refBonus, activeTool: u.activeTool, tasksClaimed: u.tasksClaimed, withdrawEligible: u.withdrawEligible, refFriendsDeposited: u.refFriendsDeposited || 0 } });
});

app.post('/api/change-password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const valid = await bcrypt.compare(oldPassword, req.user.password);
  if (!valid) return res.json({ success: false, message: 'Wrong current password' });
  if (newPassword.length < 6) return res.json({ success: false, message: 'Min 6 characters' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(req.user._id, { password: hashed });
  res.json({ success: true, message: 'Password updated successfully ✅' });
});

app.post('/api/set-pin', auth, async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 4) return res.json({ success: false, message: '4-digit PIN required' });
  await User.findByIdAndUpdate(req.user._id, { pin });
  res.json({ success: true, message: 'Payment PIN set ✅' });
});

// ===================== DEPOSIT =====================
app.post('/api/deposit/request', auth, async (req, res) => {
  try {
    const { amount, currency, utr, copiedUpi, shownUpi, userPhone } = req.body;
    if (!amount || amount < 100) return res.json({ success: false, message: 'Minimum deposit ₹100' });
    if (!utr || utr.toString().trim().length < 8) return res.json({ success: false, message: 'Valid UTR number required (min 8 digits)' });

    // ✅ STEP 1: Pehle deposit DB mein save karo — yahi sabse zaroori hai
    const dep = await Deposit.create({
      userId: req.user._id, phone: req.user.phone,
      amount, currency: currency || 'INR', utr: utr.toString().trim(),
      copiedUpi: copiedUpi || 'Not tracked',
      shownUpi: shownUpi || copiedUpi || 'Not tracked'
    });

    // ✅ STEP 2: User ko TURANT response do — timeout nahi hoga ab
    res.json({ success: true, message: 'Deposit submitted! Admin will verify within 1 hour.', depositId: dep._id });

    // ✅ STEP 3: Email + Telegram BACKGROUND mein bhejen — parallel, response ke BAAD
    // Agar email ya telegram fail bhi ho, deposit save ho chuka hai
    const confirmUrl = `${process.env.APP_URL || 'https://big-money-ten.vercel.app'}/api/admin/confirm-deposit?id=${dep._id}&key=${process.env.ADMIN_SECRET || 'bm_admin_2024'}`;
    const rejectUrl  = `${process.env.APP_URL || 'https://big-money-ten.vercel.app'}/api/admin/reject-deposit?id=${dep._id}&key=${process.env.ADMIN_SECRET || 'bm_admin_2024'}`;

    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f4f6ff;padding:28px;border-radius:14px">
        <h2 style="color:#1a1aff;margin-bottom:4px">BIG <span style="color:#ffd700">MONEY</span></h2>
        <p style="color:#888;font-size:13px;margin-bottom:20px">New Deposit Request — Action Required</p>
        <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">🆔 User ID</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${req.user.uid}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">📱 Phone</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${req.user.phone}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">💰 Amount</td><td style="padding:9px 0;font-weight:800;font-size:18px;color:#1a1aff;border-bottom:1px solid #f0f0f0">₹${amount} ${currency || 'INR'}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">🔖 UTR Number</td><td style="padding:9px 0;font-weight:800;font-size:16px;color:#00aa00;border-bottom:1px solid #f0f0f0">${dep.utr}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">👁 UPI Shown to User</td><td style="padding:9px 0;font-weight:800;font-size:15px;color:#1a1aff;border-bottom:1px solid #f0f0f0">${dep.shownUpi || 'Not tracked'}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">📲 UPI Copied by User</td><td style="padding:9px 0;font-weight:800;font-size:15px;color:#ff6600;border-bottom:1px solid #f0f0f0">${dep.copiedUpi || 'Not tracked'}</td></tr>
            <tr><td style="padding:9px 0;color:#888">🕐 Time</td><td style="padding:9px 0;font-weight:700">${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#555;margin-bottom:16px">✅ Verify the UTR in your bank/UPI app, then click <b>Confirm</b> to credit user balance.</p>
        <a href="${confirmUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#00aa00,#00cc00);color:#fff;padding:15px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:10px">✅ CONFIRM DEPOSIT — Credit ₹${amount} + 15%</a>
        <a href="${rejectUrl}" style="display:block;text-align:center;background:#ff4444;color:#fff;padding:12px;border-radius:12px;font-size:14px;font-weight:800;text-decoration:none">❌ REJECT DEPOSIT</a>
      </div>`;

    const kb = { inline_keyboard: [[
      { text: '✅ VERIFY', callback_data: `vd_${dep._id}` },
      { text: '❌ REJECT', callback_data: `rd_${dep._id}` }
    ]]};

    // Email aur Telegram DONO parallel chalao — ek bhi slow ho toh dusra wait nahi karega
    Promise.allSettled([
      sendAdminEmail(`📥 New Deposit Request — ₹${amount} | UTR: ${dep.utr}`, emailHtml),
      notifyAdmin(`📥 *New Deposit!*\n👤 ${req.user.phone} (${req.user.uid})\n💰 ₹${amount}\n🔖 UTR: \`${dep.utr}\`\n👁 UPI Shown: \`${dep.shownUpi || 'Not tracked'}\`\n📲 UPI Copied: \`${dep.copiedUpi || 'Not tracked'}\`\n🕐 ${new Date().toLocaleString('en-IN')}`, kb)
    ]).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`Notification ${i===0?'Email':'Telegram'} failed:`, r.reason?.message);
        else console.log(`Notification ${i===0?'Email':'Telegram'} sent ✅`);
      });
    });

  } catch (e) {
    console.error('Deposit error:', e.message);
    res.json({ success: false, message: 'Error: ' + e.message });
  }
});

// ===================== ADMIN CONFIRM DEPOSIT (email link) =====================
app.get('/api/admin/confirm-deposit', async (req, res) => {
  try {
    const { id, key } = req.query;
    const ADMIN_KEY = process.env.ADMIN_SECRET || 'bm_admin_2024';
    if (key !== ADMIN_KEY) return res.send(adminPage('❌ Invalid Key', 'Unauthorized access.', '#ff4444'));

    const dep = await Deposit.findById(id);
    if (!dep) return res.send(adminPage('❌ Not Found', 'Deposit request not found.', '#ff4444'));
    if (dep.status !== 'pending') return res.send(adminPage('⚠️ Already Processed', `This deposit was already ${dep.status}.`, '#ff9800'));

    dep.status = 'verified'; dep.updatedAt = new Date(); await dep.save();

    const interest = Math.round(dep.amount * 0.15 * 100) / 100;

    // Withdrawal eligibility: har 1000rs deposit pe +10%, max 40%
    const userBeforeDeposit = await User.findById(dep.userId);
    const prevTotalDeposit = userBeforeDeposit.totalDeposit || 0;
    const newTotalDeposit = prevTotalDeposit + dep.amount;
    // Kitne 1000rs slabs the pehle, kitne ab hain
    const prevSlabs = Math.floor(prevTotalDeposit / 1000);
    const newSlabs = Math.floor(newTotalDeposit / 1000);
    const newDepositUnlocks = newSlabs - prevSlabs; // kitne naye 10% unlock hue
    const currentDepositPct = userBeforeDeposit.wdDepositPct || 0;
    const currentRefPct = userBeforeDeposit.wdRefPct || 0;
    const totalCurrentPct = currentDepositPct + currentRefPct;
    // Max 40% total, deposit se max 40% aa sakta hai
    const addDepositPct = Math.min(newDepositUnlocks * 10, 40 - totalCurrentPct, 40 - currentDepositPct);
    const finalDepositPct = currentDepositPct + Math.max(0, addDepositPct);

    await User.findByIdAndUpdate(dep.userId, {
      $inc: { balance: dep.amount, totalDeposit: dep.amount, earnings: interest },
      wdDepositPct: finalDepositPct
    });
    await Transaction.create({ userId: dep.userId, type: 'Deposit', amount: dep.amount, note: 'Verified by admin' });
    await Transaction.create({ userId: dep.userId, type: '15% Interest', amount: interest, note: `Bonus on ₹${dep.amount}` });

    // Check referral eligibility — referrer ko +10% agar friend ne 1000rs deposit kiya
    const depositor = await User.findById(dep.userId);
    if (depositor && depositor.refBy && dep.amount >= 1000) {
      const referrer = await User.findOne({ uid: depositor.refBy });
      if (referrer) {
        const newCount = (referrer.refFriendsDeposited || 0) + 1;
        const refDepositPct = referrer.wdDepositPct || 0;
        const refRefPct = referrer.wdRefPct || 0;
        const refTotal = refDepositPct + refRefPct;
        // +10% per qualifying referral, max 40% total
        const addRefPct = Math.min(10, 40 - refTotal);
        const finalRefPct = refRefPct + Math.max(0, addRefPct);
        await User.findByIdAndUpdate(referrer._id, {
          refFriendsDeposited: newCount,
          wdRefPct: finalRefPct,
          withdrawEligible: (refDepositPct + finalRefPct) > 0
        });
      }
    }

    // Telegram notify

    return res.send(adminPage('✅ Deposit Confirmed!', `₹${dep.amount} + ₹${interest} interest credited to ${dep.phone}`, '#00aa00'));
  } catch (e) {
    return res.send(adminPage('❌ Error', e.message, '#ff4444'));
  }
});

app.get('/api/admin/reject-deposit', async (req, res) => {
  try {
    const { id, key } = req.query;
    const ADMIN_KEY = process.env.ADMIN_SECRET || 'bm_admin_2024';
    if (key !== ADMIN_KEY) return res.send(adminPage('❌ Invalid Key', 'Unauthorized access.', '#ff4444'));

    const dep = await Deposit.findById(id);
    if (!dep) return res.send(adminPage('❌ Not Found', 'Deposit request not found.', '#ff4444'));
    if (dep.status !== 'pending') return res.send(adminPage('⚠️ Already Processed', `This deposit was already ${dep.status}.`, '#ff9800'));

    dep.status = 'rejected'; dep.updatedAt = new Date(); await dep.save();

    return res.send(adminPage('❌ Deposit Rejected', `Deposit of ₹${dep.amount} from ${dep.phone} has been rejected.`, '#ff4444'));
  } catch (e) {
    return res.send(adminPage('❌ Error', e.message, '#ff4444'));
  }
});

function adminPage(title, msg, color) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="font-family:Arial,sans-serif;background:#f4f6ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,100,.12)">
    <div style="font-size:48px;margin-bottom:12px">${color === '#00aa00' ? '✅' : color === '#ff4444' ? '❌' : '⚠️'}</div>
    <h2 style="color:${color};margin-bottom:10px">${title}</h2>
    <p style="color:#666;font-size:14px;line-height:1.7">${msg}</p>
    <a href="/" style="display:inline-block;margin-top:20px;padding:11px 24px;background:#1a1aff;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">← Back to App</a>
  </div></body></html>`;
}

app.get('/api/deposit/history', auth, async (req, res) => {
  const deps = await Deposit.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, deposits: deps });
});

// ===================== WITHDRAWAL (direct — no lock) =====================
app.post('/api/withdraw', auth, async (req, res) => {
  try {
    const { amount, upiId, accountName, pin } = req.body;

    const totalAvailable = (req.user.balance || 0) + (req.user.earnings || 0);

    // Withdrawal eligibility check
    const wdDepositPct = req.user.wdDepositPct || 0;
    const wdRefPct = req.user.wdRefPct || 0;
    const eligiblePct = Math.min(wdDepositPct + wdRefPct, 40); // max 40%, hidden from user
    const eligibleAmt = Math.floor(totalAvailable * eligiblePct / 100);

    if (eligiblePct === 0) {
      return res.json({
        success: false,
        eligibilityError: true,
        message: 'Withdrawal locked',
        conditions: [
          'Deposit ₹1000 or more to unlock 10% withdrawal limit',
          'Refer a friend who deposits ₹1000+ to unlock an extra 10%'
        ]
      });
    }
    if (amount > eligibleAmt) {
      return res.json({
        success: false,
        eligibilityError: true,
        message: `You can withdraw up to ₹${eligibleAmt} (${eligiblePct}% of wallet)`,
        conditions: [
          `Your current withdrawal limit: ${eligiblePct}% = ₹${eligibleAmt}`,
          'Deposit ₹1000 more to increase your limit by 10%',
          'Refer a friend who deposits ₹1000+ to increase limit by 10%'
        ]
      });
    }

    if (!amount || amount < 100) return res.json({ success: false, message: 'Minimum withdrawal is ₹100' });
    if (totalAvailable < amount) return res.json({ success: false, message: `Insufficient balance. Available: ₹${totalAvailable.toFixed(2)}` });
    if (req.user.pin && req.user.pin !== pin) return res.json({ success: false, message: 'Wrong payment PIN' });
    if (!upiId || upiId.trim().length < 5) return res.json({ success: false, message: 'Valid UPI ID required' });
    if (!accountName || accountName.trim().length < 2) return res.json({ success: false, message: 'Account holder name required' });

    // Save request — DO NOT deduct balance yet (deduct only on admin confirm)
    const wd = await Withdrawal.create({
      userId: req.user._id, phone: req.user.phone,
      amount, accountDetails: upiId.trim(), accountName: accountName.trim()
    });
    await Transaction.create({ userId: req.user._id, type: 'Withdrawal Requested', amount: 0, note: `₹${amount} pending admin approval` });

    // Respond immediately
    res.json({ success: true, message: 'Withdrawal request submitted! Will be processed within 24 hours. ✅' });

    // Build confirm/reject links
    const BASE = process.env.APP_URL || 'https://big-money-ten.vercel.app';
    const KEY  = process.env.ADMIN_SECRET || 'bm_admin_2024';
    const confirmUrl = `${BASE}/api/admin/confirm-withdrawal?id=${wd._id}&key=${KEY}`;
    const rejectUrl  = `${BASE}/api/admin/reject-withdrawal?id=${wd._id}&key=${KEY}`;

    // Telegram
    const kb = { inline_keyboard: [[
      { text: '✅ APPROVE & TRANSFER', callback_data: `vw_${wd._id}` },
      { text: '❌ REJECT', callback_data: `rw_${wd._id}` }
    ]]};

    // Email + Telegram parallel background
    Promise.allSettled([
      notifyAdmin(
        `💸 *NEW WITHDRAWAL REQUEST*\n\n🆔 User ID: ${req.user.uid}\n👤 Name: ${accountName.trim()}\n📱 Phone: ${req.user.phone}\n💰 Amount: ₹${amount}\n📲 UPI ID: \`${upiId.trim()}\`\n🕐 ${new Date().toLocaleString('en-IN')}`,
        kb
      ),
      sendAdminEmail(
        `💸 Withdrawal Request — ₹${amount} | ${accountName.trim()}`,
        `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f4f6ff;padding:28px;border-radius:14px">
          <h2 style="color:#1a1aff;margin-bottom:4px">BIG <span style="color:#ffd700">MONEY</span></h2>
          <p style="color:#888;font-size:13px;margin-bottom:20px">💸 New Withdrawal Request — Action Required</p>
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">🆔 User ID</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${req.user.uid}</td></tr>
              <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">👤 Name</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${accountName.trim()}</td></tr>
              <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">📱 Phone</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${req.user.phone}</td></tr>
              <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">💰 Amount</td><td style="padding:9px 0;font-weight:800;font-size:22px;color:#1a1aff;border-bottom:1px solid #f0f0f0">₹${amount}</td></tr>
              <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">📲 UPI ID</td><td style="padding:9px 0;font-weight:800;font-size:16px;color:#00aa00;border-bottom:1px solid #f0f0f0">${upiId.trim()}</td></tr>
              <tr><td style="padding:9px 0;color:#888">🕐 Time</td><td style="padding:9px 0;font-weight:700">${new Date().toLocaleString('en-IN')}</td></tr>
            </table>
          </div>
          <p style="font-size:13px;color:#555;margin-bottom:14px">⚡ Transfer <b>₹${amount}</b> to UPI ID: <b style="color:#00aa00">${upiId.trim()}</b> — then click Confirm below to deduct from user balance.</p>
          <a href="${confirmUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#00aa00,#00cc00);color:#fff;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:10px">✅ CONFIRM — Deduct ₹${amount} & Mark Paid</a>
          <a href="${rejectUrl}" style="display:block;text-align:center;background:#ff4444;color:#fff;padding:12px;border-radius:12px;font-size:14px;font-weight:800;text-decoration:none">❌ REJECT WITHDRAWAL</a>
        </div>`
      )
    ]).catch(e => console.error('Withdrawal notify error:', e.message));

  } catch (e) { res.json({ success: false, message: 'Error: ' + e.message }); }
});

// ===================== ADMIN CONFIRM WITHDRAWAL (email link) =====================
app.get('/api/admin/confirm-withdrawal', async (req, res) => {
  try {
    const { id, key } = req.query;
    if (key !== (process.env.ADMIN_SECRET || 'bm_admin_2024')) return res.send(adminPage('❌ Invalid Key', 'Unauthorized.', '#ff4444'));
    const wd = await Withdrawal.findById(id);
    if (!wd) return res.send(adminPage('❌ Not Found', 'Withdrawal not found.', '#ff4444'));
    if (wd.status !== 'pending') return res.send(adminPage('⚠️ Already Processed', `This withdrawal was already ${wd.status}.`, '#ff9800'));

    // Now deduct from user balance
    const user = await User.findById(wd.userId);
    if (!user) return res.send(adminPage('❌ User Not Found', 'User account not found.', '#ff4444'));
    const totalAvailable = (user.earnings || 0) + (user.balance || 0);
    if (totalAvailable < wd.amount) return res.send(adminPage('⚠️ Insufficient Balance', `User only has ₹${totalAvailable.toFixed(2)} but requested ₹${wd.amount}.`, '#ff9800'));

    // Deduct from earnings first, then balance for remainder
    let deductEarnings = Math.min(user.earnings || 0, wd.amount);
    let deductBalance  = wd.amount - deductEarnings;
    await User.findByIdAndUpdate(wd.userId, { $inc: { earnings: -deductEarnings, balance: -deductBalance } });
    await Transaction.create({ userId: wd.userId, type: 'Withdrawal Approved', amount: -wd.amount, note: 'Paid by admin via UPI' });
    wd.status = 'approved'; wd.updatedAt = new Date(); await wd.save();

    return res.send(adminPage('✅ Withdrawal Confirmed!', `₹${wd.amount} deducted from ${wd.phone} (${wd.accountName}). Payment sent to ${wd.accountDetails}.`, '#00aa00'));
  } catch (e) {
    return res.send(adminPage('❌ Error', e.message, '#ff4444'));
  }
});

app.get('/api/admin/reject-withdrawal', async (req, res) => {
  try {
    const { id, key } = req.query;
    if (key !== (process.env.ADMIN_SECRET || 'bm_admin_2024')) return res.send(adminPage('❌ Invalid Key', 'Unauthorized.', '#ff4444'));
    const wd = await Withdrawal.findById(id);
    if (!wd) return res.send(adminPage('❌ Not Found', 'Withdrawal not found.', '#ff4444'));
    if (wd.status !== 'pending') return res.send(adminPage('⚠️ Already Processed', `This withdrawal was already ${wd.status}.`, '#ff9800'));

    wd.status = 'rejected'; wd.updatedAt = new Date(); await wd.save();
    await Transaction.create({ userId: wd.userId, type: 'Withdrawal Rejected', amount: 0, note: 'Rejected by admin' });

    return res.send(adminPage('❌ Withdrawal Rejected', `Withdrawal of ₹${wd.amount} from ${wd.phone} has been rejected. No balance deducted.`, '#ff4444'));
  } catch (e) {
    return res.send(adminPage('❌ Error', e.message, '#ff4444'));
  }
});

app.get('/api/withdraw/history', auth, async (req, res) => {
  const wds = await Withdrawal.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, withdrawals: wds });
});

// ===================== RESET PASSWORD (Forgot Password) =====================
app.post('/api/reset-password', async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;
    if (!phone || !otp || !newPassword) return res.json({ success: false, message: 'Phone, OTP and new password required' });
    if (newPassword.length < 6) return res.json({ success: false, message: 'Password minimum 6 characters' });

    const identifier = phone.trim();
    const otpDoc = await OTP.findOne({ identifier, otp: otp.toString() });
    if (!otpDoc) return res.json({ success: false, message: 'Invalid or expired OTP. Click Get OTP again.' });

    const user = await User.findOne({ phone });
    if (!user) return res.json({ success: false, message: 'No account found with this phone number' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(user._id, { password: hashed });
    await OTP.deleteMany({ identifier });

    console.log(`✅ Password reset for: ${phone}`);
    res.json({ success: true, message: 'Password reset successfully! Please login.' });
  } catch (e) {
    console.error('reset-password error:', e);
    res.json({ success: false, message: 'Reset failed. Try again.' });
  }
});

// ===================== AUTO-WITHDRAWAL (Toggle trigger — ₹100 fixed, 12hr cooldown) =====================
app.post('/api/withdraw/auto', auth, async (req, res) => {
  try {
    const { upiId, accountName, walletType, phone } = req.body;

    if (!upiId) return res.json({ success: false, message: 'UPI ID missing' });

    // ✅ FIXED AMOUNT: Always ₹100 only — ignore any amount sent from frontend
    const AUTO_WD_AMOUNT = 100;

    // ✅ 12-HOUR COOLDOWN CHECK
    const freshUser = await User.findById(req.user._id).lean();
    const lastWd = freshUser.lastAutoWithdraw;
    if (lastWd) {
      const hoursSinceLast = (Date.now() - new Date(lastWd).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < 12) {
        const hoursLeft = (12 - hoursSinceLast).toFixed(1);
        return res.json({
          success: false,
          message: `⏳ Auto-withdrawal already done! Next withdrawal available in ${hoursLeft} hours. (Max 2 per day, every 12 hours)`
        });
      }
    }

    // ✅ CHECK: User ke paas kam se kam ₹100 balance hona chahiye
    const totalAvailable = (freshUser.earnings || 0) + (freshUser.balance || 0);
    if (totalAvailable < AUTO_WD_AMOUNT) {
      return res.json({ success: false, message: `Insufficient balance. You need at least ₹${AUTO_WD_AMOUNT} to auto-withdraw.` });
    }

    // ✅ Save withdrawal request of exactly ₹100
    const wd = await Withdrawal.create({
      userId: req.user._id,
      phone: req.user.phone,
      amount: AUTO_WD_AMOUNT,
      accountDetails: upiId.trim(),
      accountName: accountName || phone || req.user.phone,
      note: `AUTO-WITHDRAWAL via ${walletType || 'Wallet Tool'}`
    });

    // ✅ Update lastAutoWithdraw timestamp immediately to prevent duplicate requests
    await User.findByIdAndUpdate(req.user._id, { lastAutoWithdraw: new Date() });

    await Transaction.create({
      userId: req.user._id,
      type: 'Auto-Withdrawal Requested',
      amount: 0,
      note: `₹${AUTO_WD_AMOUNT} auto-withdrawal pending admin approval`
    });

    // Respond immediately
    res.json({ success: true, message: `✅ Auto-withdrawal request of ₹${AUTO_WD_AMOUNT} sent! Admin will process it. Next request available after 12 hours.` });

    // Build confirm/reject links
    const BASE = process.env.APP_URL || 'https://big-money-ten.vercel.app';
    const KEY  = process.env.ADMIN_SECRET || 'bm_admin_2024';
    const confirmUrl = `${BASE}/api/admin/confirm-withdrawal?id=${wd._id}&key=${KEY}`;
    const rejectUrl  = `${BASE}/api/admin/reject-withdrawal?id=${wd._id}&key=${KEY}`;

    // Send admin email in background
    sendAdminEmail(
      `⚡ AUTO-WITHDRAWAL REQUEST — ₹${AUTO_WD_AMOUNT} | ${req.user.phone}`,
      `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f4f6ff;padding:28px;border-radius:14px">
        <h2 style="color:#1a1aff;margin-bottom:4px">BIG <span style="color:#ffd700">MONEY</span></h2>
        <p style="color:#888;font-size:13px;margin-bottom:6px">⚡ AUTO-WITHDRAWAL REQUEST (Toggle Triggered)</p>
        <div style="background:#fff3cd;border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:#856404;font-weight:700">
          ⚠️ User turned ON Auto-Withdrawal toggle. Fixed amount ₹${AUTO_WD_AMOUNT}. Please process manually and click Confirm below.
        </div>
        <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">🆔 User ID</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${req.user.uid}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">📱 Phone</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${req.user.phone}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">💳 Wallet Type</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #f0f0f0">${walletType || 'Wallet Tool'}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">💰 Amount (Fixed)</td><td style="padding:9px 0;font-weight:800;font-size:22px;color:#1a1aff;border-bottom:1px solid #f0f0f0">₹${AUTO_WD_AMOUNT}</td></tr>
            <tr><td style="padding:9px 0;color:#888;border-bottom:1px solid #f0f0f0">📲 UPI ID</td><td style="padding:9px 0;font-weight:800;font-size:16px;color:#00aa00;border-bottom:1px solid #f0f0f0">${upiId.trim()}</td></tr>
            <tr><td style="padding:9px 0;color:#888">🕐 Time</td><td style="padding:9px 0;font-weight:700">${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#555;margin-bottom:14px">⚡ Transfer <b>₹${AUTO_WD_AMOUNT}</b> to UPI: <b style="color:#00aa00">${upiId.trim()}</b> — then click Confirm to deduct from user balance.</p>
        <a href="${confirmUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#00aa00,#00cc00);color:#fff;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:10px">✅ CONFIRM — Deduct ₹${AUTO_WD_AMOUNT} & Mark Paid</a>
        <a href="${rejectUrl}" style="display:block;text-align:center;background:#ff4444;color:#fff;padding:12px;border-radius:12px;font-size:14px;font-weight:800;text-decoration:none">❌ REJECT</a>
      </div>`
    ).catch(e => console.error('Auto-WD email failed:', e.message));

  } catch (e) { res.json({ success: false, message: 'Error: ' + e.message }); }
});


const TOOLS = [
  { id: 1, name: 'Starter Tool', emoji: '🌱', price: 100, daily: 15, days: 30, cls: 't1' },
  { id: 2, name: 'Silver Tool', emoji: '🥈', price: 500, daily: 15, days: 30, cls: 't2' },
  { id: 3, name: 'Gold Tool', emoji: '🥇', price: 2000, daily: 15, days: 30, cls: 't3' },
  { id: 4, name: 'Diamond Tool', emoji: '💎', price: 10000, daily: 15, days: 45, cls: 't4' },
  { id: 5, name: 'Platinum Tool', emoji: '🏆', price: 40000, daily: 15, days: 60, cls: 't5' },
  { id: 6, name: 'Elite Tool', emoji: '👑', price: 80000, daily: 15, days: 90, cls: 't6' },
];

app.post('/api/tool/buy', auth, async (req, res) => {
  try {
    const { toolId, pin } = req.body;
    const tool = TOOLS.find(t => t.id === toolId);
    if (!tool) return res.json({ success: false, message: 'Invalid tool' });
    if (req.user.balance < tool.price) return res.json({ success: false, message: 'Insufficient balance. Please deposit first.' });
    if (req.user.pin && req.user.pin !== pin) return res.json({ success: false, message: 'Wrong payment PIN' });
    const dailyEarn = (tool.price * tool.daily) / 100;
    const activeTool = { ...tool, purchasedAt: new Date(), dailyEarn, expiresAt: new Date(Date.now() + tool.days * 86400000) };
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: -tool.price }, activeTool });
    await Transaction.create({ userId: req.user._id, type: 'Tool Purchase', amount: -tool.price, note: tool.name });
    res.json({ success: true, message: `🎉 ${tool.name} activated! You earn ₹${dailyEarn}/day`, dailyEarn });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===================== WALLET TOOL ADD =====================
app.post('/api/tool/add-wallet', auth, async (req, res) => {
  try {
    const { walletId, walletName, phone, otp, upiId } = req.body;
    if (!walletId || !phone) return res.json({ success: false, message: 'Wallet details required' });

    // OTP verify karo (apna system)
    const identifier = phone.trim();
    const otpDoc = await OTP.findOne({ identifier, otp: otp?.toString() });
    if (!otpDoc) return res.json({ success: false, message: 'Invalid or expired OTP' });

    // Multiple wallet tools allowed — no restriction

    // Wallet tool activate karo (free - no balance deduction)
    const activeTool = {
      walletId, walletName, phone, upiId,
      price: 100, daily: 15, days: 30,
      dailyEarn: 15,
      purchasedAt: new Date(),
      daysLeft: 30,
      expiresAt: new Date(Date.now() + 30 * 86400000)
    };

    await User.findByIdAndUpdate(req.user._id, { activeTool });
    await OTP.deleteMany({ identifier });

    // Notify admin
    notifyAdmin(`🔧 *New Wallet Tool Added!*\n👤 ${req.user.phone} (${req.user.uid})\n💳 Wallet: ${walletName}\n📱 Number: ${phone}\n🕐 ${new Date().toLocaleString('en-IN')}`);

    res.json({ success: true, message: `${walletName} wallet added successfully!` });
  } catch (e) { res.json({ success: false, message: e.message }); }
});


app.post('/api/task/claim', auth, async (req, res) => {
  try {
    const { taskId } = req.body;
    const today = new Date().toDateString();
    const key = `${taskId}_${today}`;
    if (req.user.tasksClaimed && req.user.tasksClaimed[key]) return res.json({ success: false, message: 'Task already claimed today' });
    const rewards = { 1: 10, 2: 25, 3: 15 };
    const reward = rewards[taskId];
    if (!reward) return res.json({ success: false, message: 'Invalid task' });
    const updatedClaimed = { ...req.user.tasksClaimed, [key]: true };
    await User.findByIdAndUpdate(req.user._id, { $inc: { earnings: reward }, tasksClaimed: updatedClaimed });
    await Transaction.create({ userId: req.user._id, type: 'Task Reward', amount: reward, note: `Task #${taskId}` });
    res.json({ success: true, message: `✅ ₹${reward} added to your earnings!`, reward });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===================== TRANSACTIONS =====================
app.get('/api/transactions', auth, async (req, res) => {
  const txns = await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, transactions: txns });
});

// ===================== TEAM =====================
app.get('/api/team', auth, async (req, res) => {
  const members = await User.find({ refBy: req.user.uid }).select('phone uid createdAt totalDeposit');
  res.json({ success: true, members, refCount: req.user.refCount, refBonus: req.user.refBonus, refFriendsDeposited: req.user.refFriendsDeposited || 0 });
});

// ===================== SERVE FRONTEND =====================
app.get('*', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.send('BIG MONEY API ✅');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 BIG MONEY running on port ${PORT}`));
