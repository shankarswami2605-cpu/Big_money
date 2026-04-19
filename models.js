const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  password: { type: String, required: true },
  uid: { type: String, unique: true },
  balance: { type: Number, default: 0 },
  earnings: { type: Number, default: 0 },
  totalDeposit: { type: Number, default: 0 },
  pin: { type: String, default: null },
  refCode: { type: String, unique: true },
  refBy: { type: String, default: null },
  refCount: { type: Number, default: 0 },
  refBonus: { type: Number, default: 0 },
  // Withdrawal eligibility tracking
  withdrawEligible: { type: Boolean, default: false },
  refFriendsDeposited: { type: Number, default: 0 }, // how many referred friends deposited 500+
  activeTool: { type: Object, default: null },
  tasksClaimed: { type: Object, default: {} },
  lastAutoWithdraw: { type: Date, default: null }, // 12-hour cooldown tracking
  createdAt: { type: Date, default: Date.now }
});

const depositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone: String,
  amount: Number,
  utr: { type: String, default: '' },
  copiedUpi: { type: String, default: 'Not tracked' },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const withdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone: String,
  amount: Number,
  accountDetails: String,
  ifsc: String,
  accountName: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: String,
  amount: Number,
  note: String,
  createdAt: { type: Date, default: Date.now }
});

const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true }, // phone or email
  otp: String,
  createdAt: { type: Date, default: Date.now, expires: 300 }
});

const User = mongoose.model('User', userSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const OTP = mongoose.model('OTP', otpSchema);

module.exports = { User, Deposit, Withdrawal, Transaction, OTP };
