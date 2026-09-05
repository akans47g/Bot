/* =================================================================
   PRODUCTS.JS — Har Bundle ka Naam, Rate, aur Tier Price Overrides
   =================================================================
   👉 RATE = ₹ price for 1000 quantity (normal/linear calculation).
      Formula: Total Price = (rate / 1000) * selected quantity
      Example: rate 200, quantity 500 -> price = ₹100

   👉 tierPrices — agar kisi specific quantity (50/100/300/500/
      1000/5000/10000/50000) ka price is LINEAR formula se ALAG
      rakhna ho, to yahan us quantity ke against apna price likh do.
      Jo quantity yahan NAHI hai, uska price normal rate se hi
      calculate hoga.
      Example: agar 1000 content ka rate 100 hai (normal 1000
      content = ₹100), lekin 50 content khaas taur par ₹10 me
      bechna hai (normal se zyada), to:
        tierPrices: { "50": 10 }

   ⚠️ Abhi sabka rate 200 (placeholder) hai aur koi tier override
      nahi hai — Admin Panel → Bundles se dono edit ho sakenge.
================================================================= */

const PRODUCTS = {
  hulk:     { name: "Hulk Videos Bundle",             rate: 200, tierPrices: {} },
  cricket:  { name: "Cricket Videos Bundle",          rate: 200, tierPrices: {} },
  food:     { name: "Food Cutting Videos Bundle",     rate: 200, tierPrices: {} },
  car:      { name: "Car Videos Bundle",              rate: 200, tierPrices: {} },
  anime:    { name: "Anime Videos Bundle",            rate: 200, tierPrices: {} },
  moral:    { name: "2D Moral Story Long Videos",     rate: 200, tierPrices: {} },
  monkey:   { name: "Monkey Vlog Videos",             rate: 200, tierPrices: {} },
  lifehack: { name: "Daily Life Hacks Videos",        rate: 200, tierPrices: {} },
  nature:   { name: "Nature Videos Bundle",           rate: 200, tierPrices: {} },
  horror:   { name: "Horror Videos Bundle",           rate: 200, tierPrices: {} },
  art:      { name: "ART & Satisfying Videos Bundle", rate: 200, tierPrices: {} },
  gym:      { name: "Gym Boy & Attitude Videos",      rate: 200, tierPrices: {} },
  romantic: { name: "2D Romantic Short Videos",       rate: 200, tierPrices: {} },
  cat:      { name: "Cat Story's Bundle",             rate: 200, tierPrices: {} },
  womangym: { name: "Woman Gym Bundle",               rate: 200, tierPrices: {} },
  sanatani: { name: "Sanatani AI Reel Bundle",        rate: 200, tierPrices: {} },
  stock:    { name: "Stock Market Bundle",            rate: 200, tierPrices: {} }
};

window.PRODUCTS = PRODUCTS;
