/* =================================================================
   PRODUCTS.JS — Har Bundle ka Naam aur Rate (per 1000)
   =================================================================
   👉 Yahan se kisi bhi bundle ka NAME ya RATE change kar sakte ho.
   👉 RATE = ₹ price for 1000 quantity.
      Formula: Total Price = (rate / 1000) * selected quantity
      Example: rate 200, quantity 500 -> price = ₹100

   ⚠️ Abhi sabka rate 200 (placeholder) set hai — apne hisaab se
      har product ka alag rate yahan set kar do.

   🔜 Jab Admin Panel banega, to yeh values wahan se bhi edit ho
      sakengi (products-loader.js Firestore se in values ko
      override karega).
================================================================= */

const PRODUCTS = {
  hulk:     { name: "Hulk Videos Bundle",             rate: 200 },
  cricket:  { name: "Cricket Videos Bundle",          rate: 200 },
  food:     { name: "Food Cutting Videos Bundle",     rate: 200 },
  car:      { name: "Car Videos Bundle",              rate: 200 },
  anime:    { name: "Anime Videos Bundle",            rate: 200 },
  moral:    { name: "2D Moral Story Long Videos",     rate: 200 },
  monkey:   { name: "Monkey Vlog Videos",             rate: 200 },
  lifehack: { name: "Daily Life Hacks Videos",        rate: 200 },
  nature:   { name: "Nature Videos Bundle",           rate: 200 },
  horror:   { name: "Horror Videos Bundle",           rate: 200 },
  art:      { name: "ART & Satisfying Videos Bundle", rate: 200 },
  gym:      { name: "Gym Boy & Attitude Videos",      rate: 200 },
  romantic: { name: "2D Romantic Short Videos",       rate: 200 },
  cat:      { name: "Cat Story's Bundle",             rate: 200 },
  womangym: { name: "Woman Gym Bundle",               rate: 200 },
  sanatani: { name: "Sanatani AI Reel Bundle",        rate: 200 },
  stock:    { name: "Stock Market Bundle",            rate: 200 }
};

window.PRODUCTS = PRODUCTS;
