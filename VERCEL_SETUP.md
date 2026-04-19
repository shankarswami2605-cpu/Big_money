# 🚀 BIG MONEY — Vercel Setup Guide

## Step 1: GitHub Pe Upload Karo
Saari files ek folder mein rakho aur GitHub repo banao (public ya private dono chalega).

---

## Step 2: Vercel Pe Deploy Karo
1. vercel.com pe jao → "Add New Project"
2. GitHub repo import karo
3. Framework = **Other** select karo
4. Deploy dabao — URL milega jaise `https://your-project.vercel.app`

---

## Step 3: Environment Variables Set Karo
Vercel → Project → Settings → Environment Variables

| Variable Name   | Value                                                                                                          |
|-----------------|----------------------------------------------------------------------------------------------------------------|
| `MONGODB_URI`   | `mongodb+srv://shankarswami2605_db_user:xG13614e6dpV9ad1@cluster0.vhhl9ly.mongodb.net/?appName=Cluster0`      |
| `JWT_SECRET`    | `bigmoney_jwt_secret_2024`                                                                                     |
| `GMAIL_PASS`    | `otpcmvabhfjmwmdu`                                                                                             |
| `ADMIN_SECRET`  | `bm_admin_2024`                                                                                                |
| `APP_URL`       | `https://your-project.vercel.app`  ← apna actual Vercel URL daalo                                             |

> ⚠️ APP_URL mein apna actual URL daalo — pehle deploy karo, URL milega, phir ye variable set karo.

---

## Step 4: Redeploy Karo
Variables set karne ke baad Vercel → Deployments → Redeploy karo.

---

## Admin Notifications
Admin ko saari deposit/withdrawal notifications is email pe aayengi:
📧 **shankarswami@gmail.com**

Confirm/Reject links directly email mein aate hain — koi extra admin panel nahi chahiye.

---

## ⚠️ UPI IDs Change Karna Ho Toh
`index.html` file mein line ~530 pe `UPI_LIST` array hai — wahan apne UPI IDs daal do.
