// Recipe sources grouped by cuisine. Every site is a WordPress blog whose search we can query; all must also be
// listed in api/fetch.js (the server only fetches allow-listed sites).
export const REGIONS={
  indian:['hebbarskitchen.com','cookwithmanali.com','ministryofcurry.com','spiceupthecurry.com','aromaticessence.co','whiskaffair.com'],
  american:['spendwithpennies.com','budgetbytes.com','damndelicious.net','thecookierookie.com'],
  eastasian:['thewoksoflife.com','justonecookbook.com','omnivorescookbook.com','maangchi.com'],
  seasian:['rasamalaysia.com','hungryhuy.com','hot-thai-kitchen.com','marionskitchen.com'],
  mideast:['themediterraneandish.com','feelgoodfoodie.net','cookingwithayeh.com','mymoroccanfood.com'],
  latin:['isabeleats.com','mexicoinmykitchen.com','mycolombianrecipes.com','laylita.com'],
  african:['africanbites.com','sisijemimah.com','preciouscore.com','mydiasporakitchen.com'],
  europe:['italianrecipebook.com','natashaskitchen.com','cafedelites.com','daringgourmet.com']};
const KEYS={
  indian:/\b(aloo|alu|gobi|paneer|dal|dahl|daal|masala|biryani|biriyani|tikka|korma|vindaloo|saag|palak|chole|chana|rajma|roti|chapati|paratha|parantha|naan|dosa|idli|sambar|upma|poha|samosa|pakora|bhaji|raita|kheer|halwa|lassi|tandoori|khichdi|thali|bhindi|baingan|jeera|ghee|kadai|kadhai|pulao|curry)\b/,
  eastasian:/\b(sushi|ramen|teriyaki|miso|tempura|udon|dumplings?|gyoza|kung pao|chow mein|lo mein|fried rice|bulgogi|kimchi|bibimbap|japchae|tteokbokki|mapo|dim sum|bao|katsu|yakitori|soba|tofu)\b/,
  seasian:/\b(pad thai|pho|banh mi|tom yum|tom kha|laksa|satay|rendang|nasi|adobo|pancit|larb|spring rolls?|lumpia|sambal|massaman)\b/,
  mideast:/\b(hummus|falafel|shawarma|kebabs?|tagine|shakshuka|tabbouleh|baba ganoush|kofta|fattoush|labneh|couscous|pita|baklava|dolma|manakish|shish|harissa)\b/,
  latin:/\b(tacos?|burritos?|enchiladas?|empanadas?|arepas?|ceviche|tamales?|pozole|mole|quesadillas?|guacamole|fajitas?|churros?|salsa|carnitas|pupusas?|feijoada|chimichurri|tostadas?|elote)\b/,
  african:/\b(jollof|egusi|suya|injera|fufu|bobotie|puff puff|moi moi|berbere|doro wat|peri peri|piri piri|chakalaka)\b/,
  europe:/\b(pasta|lasagn?a|risotto|pizza|carbonara|pierogi|goulash|paella|schnitzel|gnocchi|ratatouille|quiche|crepes?|borscht|stroganoff|bolognese|tiramisu|moussaka|spanakopita|souvlaki|gyro)\b/};
const ORDER=['indian','american','mideast','eastasian','seasian','latin','african','europe'];
export const ALL_SITES=Object.values(REGIONS).flat();
// Which sites to ask first (likely cuisine), and which to try if that finds nothing.
export function regionPlan(name){
  const q=String(name).toLowerCase(),alt=q.replace(/([bdgkjp])h(?=[aeiou])/g,'$1'); // "gobhi" -> "gobi"
  const hit=Object.keys(KEYS).filter(r=>KEYS[r].test(q)||KEYS[r].test(alt));
  const first=hit.length?hit:['indian','american'];
  const rest=ORDER.filter(r=>!first.includes(r));
  return {first:first.flatMap(r=>REGIONS[r]),rest:rest.flatMap(r=>REGIONS[r])};
}