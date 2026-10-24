/* Kens Hub shared layer. Build 2026-10-24.
   citywidelv.github.io/kens-hub/ is a client-facing hub for Ken's Foods Las Vegas plant staff and the
   City Wide porters working the plant on three shifts. It is a copy of the Ovation Hub pattern with a
   different data model: one site, 22 areas on a scheduled round plan, three shifts a day, no approval
   step. Its backend is its OWN Apps Script project (CW Kens Hub Backend), so nothing here touches the
   CW Team Portal Backend version history.

   Three tiers, three passcodes, all checked server side:
     client  (script property KH_PASSCODE)      Ken's Foods staff and the porters
     manager (script property KH_MGR_PASSCODE)  the porter vendor's site manager
     team    (script property KH_TEAM_PASSCODE) City Wide staff; the same team passcode as every hub,
                                                read from the device's cw-auth.js unlock, never typed here
   Everything a page needs to paint is in this file: areas, rounds, shifts, the gate, post helper,
   photo shrink. No fetch on load. */
(function(){
  "use strict";
  var WEBHOOK = "__KH_WEBHOOK__";
  var KEY = "cwKensPass";
  var TEAMKEY = "cwOpsHubPass";
  var STAMP = "cwKensSince";
  var MAXAGE = 90 * 24 * 60 * 60 * 1000;
  var HUB = "https://citywidelv.github.io/kens-hub/";
  var LOGO = "https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png";
  var KLOGO = "kens-logo.jpg";
  var SITE = "Ken's Foods Las Vegas";

  /* The three porter shifts, from the End of Shift Checklist. Each stop is the round the porter is
     due to make in that hour. "area" links a stop to the AREAS entry it covers (first area listed). */
  var SHIFTS = [
    { key:"1", name:"1st Shift", hours:"6:00 AM to 2:30 PM", stops:[
      { t:"6:00 AM", what:"2nd floor: training rooms, hallway, stairs and elevator (back staircase included)", areas:["trainingrooms","halls2nd","staircases","elevators"] },
      { t:"7:00 AM", what:"Hygiene Room", areas:["hygieneroom"] },
      { t:"8:00 AM", what:"Break Room (Cantina)", areas:["breakroom"] },
      { t:"9:00 AM", what:"Women's restroom and locker room", areas:["womensrestroom"] },
      { t:"10:00 AM", what:"Any deep cleaning", areas:["deepcleaning"] },
      { t:"10:00 AM", what:"Men's restroom and locker room", areas:["mensrestroom"] },
      { t:"11:00 AM", what:"Hygiene Room", areas:["hygieneroom"] },
      { t:"12:00 PM", what:"Trucker Lounge and bathrooms, warehouse bathroom", areas:["truckerlounge"] },
      { t:"1:00 PM", what:"Trucker Lounge and bathrooms, warehouse bathroom", areas:["truckerlounge"] },
      { t:"2:00 PM", what:"PT Room and EHS Office", areas:["ptroom"] } ] },
    { key:"2", name:"2nd Shift", hours:"2:00 PM to 10:30 PM", stops:[
      { t:"2:00 PM", what:"PT Room and EHS Office", areas:["ptroom"] },
      { t:"3:00 PM", what:"Break Room (Cantina)", areas:["breakroom"] },
      { t:"4:00 PM", what:"Hallways, Uniform Room, trash cans", areas:["hallways1st","uniformroom"] },
      { t:"5:00 PM", what:"Hygiene Room", areas:["hygieneroom"] },
      { t:"6:00 PM", what:"Maintenance offices, warehouse managers offices, QA Lab", areas:["maintenanceoffices","warehousemanagers","qalab"] },
      { t:"7:00 PM", what:"Men's restroom and locker room", areas:["mensrestroom"] },
      { t:"8:00 PM", what:"Women's restroom and locker room", areas:["womensrestroom"] },
      { t:"9:00 PM", what:"Reception", areas:["reception"] },
      { t:"10:00 PM", what:"Culinary Center", areas:["culinarycenter"] } ] },
    { key:"3", name:"3rd Shift", hours:"10:00 PM to 6:30 AM", stops:[
      { t:"10:00 PM", what:"Culinary Center", areas:["culinarycenter"] },
      { t:"11:00 PM", what:"Warehouse offices and bathrooms, Trucker Lounge and bathrooms", areas:["warehouseoffices","truckerlounge"] },
      { t:"12:00 AM", what:"Hygiene Room", areas:["hygieneroom"] },
      { t:"1:00 AM", what:"Hallways, Uniform Room, trash cans, Break Room deep clean", areas:["hallways1st","uniformroom","breakroom"] },
      { t:"2:00 AM", what:"Men's restroom and locker room", areas:["mensrestroom"] },
      { t:"3:00 AM", what:"Women's restroom and locker room", areas:["womensrestroom"] },
      { t:"4:00 AM", what:"Hygiene Room", areas:["hygieneroom"] },
      { t:"5:00 AM", what:"1st floor offices, bathrooms and conference room", areas:["firstflooroffices","bathrooms1st","conferenceroom"] },
      { t:"6:00 AM", what:"HR offices, 1st floor common areas", areas:["hroffices","hallways1st"] } ] }
  ];
  function shiftFor(key){ for(var i = 0; i < SHIFTS.length; i++) if(SHIFTS[i].key === String(key)) return SHIFTS[i]; return null; }
  /* Which shift is on the clock right now (local time). 1st 6:00 to 14:29, 2nd 14:00 to 22:29, 3rd 22:00 to 6:29. The overlaps go to the shift that is starting. */
  function shiftNow(){ var h = new Date().getHours(); if(h >= 6 && h < 14) return "1"; if(h >= 14 && h < 22) return "2"; return "3"; }

  /* Every area on the Area Cleaning Checklist (Detailed) Jotform, keys matching the QR code values the
     plant already uses (?area=<key>). rounds = the scheduled visits; the round marked thorough:true
     carries the DAILY tasks on top of the EVERY VISIT tasks. periodic = weekly / monthly, ticked only
     when done. Task wording is the Jotform's English with the Spanish kept after it, because the
     porters read both. closed = the area is closed to the plant while it is cleaned. */
  var AREAS = [
    { key:"hygieneroom", name:"Hygiene Room", rounds:["12:00 AM","4:00 AM","7:00 AM","12:00 PM","5:00 PM"], thorough:"12:00 AM",
      every:["Check/empty trash. (Revise/vacíe la basura.)","Check paper towel and Meritech soap dispensers. (Revise los dispensadores de toallas de papel y jabón Meritech.)","Replenish hair/beard net and ear plug supplies. (Reponga los suministros de redes para el cabello/barba y tapones para los oídos.)","Keep hygiene rooms neat and clean, checking each time you walk through. (Mantenga las salas de higiene ordenadas y limpias.)","Clean and restock boot scrubber. (Limpie y reponga el lavabotas.)","Remove splash marks from walls, equipment and doors. (Elimine las marcas de salpicaduras de las paredes, equipos y puertas.)"],
      daily:["Wipe down/sanitize Meritech hand wash units. (Limpie/desinfecte las unidades de lavado de manos Meritech.)","Clean and sanitize stainless shelves. (Limpie y desinfecte los estantes de acero inoxidable.)","Clean and polish mirrors, door window glass. (Limpie y pula los espejos y el vidrio de las puertas.)","Wipe paper towel cabinet cover. (Limpie la cubierta del gabinete de toallas de papel.)","Mop the floor. (Trapee el piso.)","Separate rubber foot bath mats and clean housing and mats of each unit. (Separe los tapetes de goma del baño de pies y limpie la carcasa y los tapetes.)","Deep clean room and walls. (Limpieza profunda de la sala y las paredes.)","Restock supplies in the closet. (Reponga los suministros en el armario.)"],
      periodic:["[WEEKLY] Dust/wipe down top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Detail floor corners and trim.","[MONTHLY] Scrub floor grout and detail baseboards.","[MONTHLY] Clean and disinfect vent covers and light diffusers."] },
    { key:"hallways1st", name:"Hallways (1st Floor)", rounds:["1:00 AM","6:00 AM","4:00 PM"], thorough:"1:00 AM",
      every:["Empty all trash cans and replace liners. (Vacíe todos los botes de basura y cambie las bolsas.)","Police halls for debris and remove. (Recoja la basura y los escombros de los pasillos.)","Spot clean spills. (Limpie los derrames.)"],
      daily:["Sweep/dust mop all hall floors. (Barra/trapee en seco todos los pisos de los pasillos.)","Mop hall floors. (Trapee los pisos de los pasillos.)","Sanitize door handles and push plates. (Desinfecte las manijas y placas de empuje de las puertas.)","Sanitize trash can lids and exteriors. (Desinfecte las tapas y exteriores de los botes de basura.)"],
      periodic:["[WEEKLY] Dust high ledges, wall fixtures and HVAC vents.","[WEEKLY] Detail floor edges and corners.","[WEEKLY] Wash out trash cans.","[MONTHLY] Spot clean hallway walls and door frames."] },
    { key:"uniformroom", name:"Uniform Room", rounds:["1:00 AM","4:00 PM"], thorough:"1:00 AM",
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Straighten and restock uniform room. (Ordene y reponga la sala de uniformes.)","Spot clean spills. (Limpie los derrames.)"],
      daily:["Sweep and mop uniform room floor. (Barra y trapee el piso de la sala de uniformes.)","Sanitize door handles and light switches. (Desinfecte manijas de puertas e interruptores de luz.)","Wipe down counters and sorting surfaces. (Limpie mostradores y superficies de clasificación.)","Ensure laundry is not overflowing from the chute and switch out full bins as needed. (Asegúrese de que la lavandería no se desborde y cambie los contenedores llenos.)"],
      periodic:["[WEEKLY] Wipe down shelving and bins.","[WEEKLY] Dust ledges, wall fixtures and HVAC vents.","[WEEKLY] Detail floor corners and trim.","[MONTHLY] Spot clean walls and door frames."] },
    { key:"breakroom", name:"Break Room (Cantina)", rounds:["1:00 AM","8:00 AM","3:00 PM"], thorough:"1:00 AM",
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Check paper towel and soap dispensers. (Revise los dispensadores de toallas de papel y jabón.)","Wipe down/sanitize tables and counters. (Limpie/desinfecte las mesas y mostradores.)","Wipe down kitchenette countertops. (Limpie los mostradores de la cocineta.)","Spot sweep as needed. (Barra según sea necesario.)","Restock coffee, sugar, creamer, cups, stir sticks. (Reponga café, azúcar, crema, vasos, agitadores.)","Empty used coffee packets and clean spillage tray. (Vacíe los paquetes de café usados y limpie la bandeja de derrames.)","Restock tables with paper towels and supplies. (Reponga las mesas con toallas de papel y suministros.)"],
      daily:["Clean and sanitize inside and outside of microwaves. (Limpie y desinfecte el interior y exterior de los microondas.)","Sanitize all sink basins, polish bright work. (Desinfecte todos los lavabos, pula los elementos brillantes.)","Damp wipe/sanitize seating. (Limpie con paño húmedo/desinfecte los asientos.)","Spot clean walls near trash receptacles with a disinfectant. (Limpie las manchas de las paredes cerca de los botes de basura.)","Remove splash marks from walls and floors around sinks and coffee machines. (Elimine las salpicaduras alrededor de lavabos y cafeteras.)","Wipe paper towel cabinet and soap dispenser covers. (Limpie las cubiertas del gabinete de toallas y del dispensador de jabón.)","Mop the floor. (Trapee el piso.)","Spot clean glass doors: vending, refrigerators. (Limpie las puertas de vidrio: expendedoras, refrigeradores.)","Restock kitchenette: plates, bowls, paper towels, utensils, sauce packets. (Reponga la cocineta.)","Ensure water and ice machines are wiped down and trays cleaned. (Limpie las máquinas de agua y hielo y las bandejas.)","Detailed clean of cabinet fronts, tops and sides. (Limpieza detallada de los gabinetes.)","Detail floor corners, edges and trim. (Limpie a detalle esquinas, bordes y molduras del piso.)"],
      periodic:["[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Wipe down storage cubbies.","[MONTHLY] Clean out the refrigerators per posted schedule.","[MONTHLY] Deep clean vending machine and appliance exteriors."] },
    { key:"mensrestroom", name:"Men's Restroom / Locker Room", rounds:["2:00 AM","11:00 AM","7:00 PM"], thorough:"2:00 AM", closed:true,
      every:["Check/empty trash. (Revise/vacíe la basura.)","Check paper towel, soap, and toilet paper dispensers. (Revise los dispensadores de toallas de papel, jabón y papel higiénico.)","Clean and sanitize inside and outside of toilets and urinals. (Limpie y desinfecte los inodoros y urinarios.)","Wipe down/sanitize stall handles and toilet paper holders. (Limpie/desinfecte las manijas de los cubículos y los soportes de papel.)","Sanitize all sink basins, polish bright work. (Desinfecte todos los lavabos, pula los elementos brillantes.)","Clean and polish mirrors. (Limpie y pula los espejos.)","Wipe down countertops. (Limpie los mostradores.)","Wipe paper towel cabinet cover. (Limpie la cubierta del gabinete de toallas de papel.)","Remove splash marks from walls around basins, toilets, urinals and partitions. (Elimine las salpicaduras de las paredes.)","Sweep/mop the floor. (Barra/trapee el piso.)","Clean and disinfect showers and polish bright work. (Limpie y desinfecte las duchas.)","Damp wipe/sanitize bench seating in locker room. (Limpie/desinfecte los bancos del vestuario.)","Check hangers. (Revise los colgadores.)"],
      daily:["Dust fronts, tops and sides of lockers. (Quite el polvo de los frentes, partes superiores y lados de los casilleros.)"],
      periodic:["[WEEKLY] Damp wipe fronts, tops and sides of lockers.","[WEEKLY] Wipe down walls and partitions.","[WEEKLY] Dust/wipe down top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Detail floor corners and trim.","[MONTHLY] Scrub floor and wall grout.","[MONTHLY] Descale urinals, toilets and fixtures.","[MONTHLY] Clean and disinfect vent covers and light diffusers."] },
    { key:"womensrestroom", name:"Women's Restroom / Locker Room", rounds:["3:00 AM","9:00 AM","8:00 PM"], thorough:"3:00 AM", closed:true,
      every:["Check/empty trash. (Revise/vacíe la basura.)","Check paper towel, soap, and toilet paper dispensers. (Revise los dispensadores de toallas de papel, jabón y papel higiénico.)","Clean and sanitize inside and outside of toilets. (Limpie y desinfecte los inodoros.)","Wipe down/sanitize stall handles and toilet paper holders. (Limpie/desinfecte las manijas de los cubículos y los soportes de papel.)","Empty sanitary napkin receptacles and damp wipe with disinfectant. (Vacíe los recipientes para toallas sanitarias y limpie con desinfectante.)","Sanitize all sink basins, polish bright work. (Desinfecte todos los lavabos, pula los elementos brillantes.)","Clean and polish mirrors. (Limpie y pula los espejos.)","Wipe down countertops. (Limpie los mostradores.)","Wipe paper towel cabinet cover. (Limpie la cubierta del gabinete de toallas de papel.)","Remove splash marks from walls around basins, toilets and partitions. (Elimine las salpicaduras de las paredes.)","Sweep/mop the floor. (Barra/trapee el piso.)","Clean and disinfect showers and polish bright work. (Limpie y desinfecte las duchas.)","Damp wipe/sanitize bench seating in locker room. (Limpie/desinfecte los bancos del vestuario.)","Check hangers. (Revise los colgadores.)"],
      daily:["Dust fronts, tops and sides of lockers. (Quite el polvo de los frentes, partes superiores y lados de los casilleros.)"],
      periodic:["[WEEKLY] Damp wipe fronts, tops and sides of lockers.","[WEEKLY] Wipe down walls and partitions.","[WEEKLY] Dust/wipe down top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Detail floor corners and trim.","[MONTHLY] Scrub floor and wall grout.","[MONTHLY] Descale toilets and fixtures.","[MONTHLY] Clean and disinfect vent covers and light diffusers."] },
    { key:"staircases", name:"Staircases (Front & Back)", rounds:["8:00 AM (Front)","2:00 PM (Back)"], thorough:"8:00 AM (Front)",
      every:["Police stairs and landings for debris. (Recoja la basura de escaleras y descansos.)","Sanitize handrails. (Desinfecte los pasamanos.)","Spot clean spills. (Limpie los derrames.)"],
      daily:["Sweep/dust mop stair treads and landings. (Barra/trapee en seco los escalones y descansos.)","Mop stair treads and landings. (Trapee los escalones y descansos.)","Spot clean stairwell glass and door glass. (Limpie el vidrio del hueco de escalera y de las puertas.)"],
      periodic:["[WEEKLY] Detail stair corners, edges and stringers.","[WEEKLY] Dust stairwell ledges, fixtures and vents.","[MONTHLY] Spot clean stairwell walls."] },
    { key:"truckerlounge", name:"Trucker Lounge", sub:"Includes both trucker bathrooms and the warehouse bathroom.", rounds:["1:00 PM","11:00 PM"], thorough:"11:00 PM",
      every:["Check/empty trash in lounge and all bathrooms. (Revise/vacíe la basura del lounge y todos los baños.)","Check paper towel, soap and toilet paper dispensers in all 3 bathrooms. (Revise los dispensadores en los 3 baños.)","Wipe down/sanitize tables, counters and seating. (Limpie/desinfecte mesas, mostradores y asientos.)","Spot sweep and spot clean spills. (Barra y limpie derrames.)","Spot clean mirrors and splash marks in bathrooms. (Limpie espejos y salpicaduras en los baños.)"],
      daily:["Clean and sanitize all toilets and urinals, inside and out. (Limpie y desinfecte todos los inodoros y urinarios.)","Sanitize all sink basins and polish bright work. (Desinfecte todos los lavabos y pula elementos brillantes.)","Clean and polish all bathroom mirrors. (Limpie y pula todos los espejos de los baños.)","Sweep and mop lounge and all bathroom floors. (Barra y trapee los pisos del lounge y de todos los baños.)","Sanitize door handles and light switches. (Desinfecte manijas e interruptores.)","Clean microwave and appliance exteriors. (Limpie el microondas y exteriores de electrodomésticos.)"],
      periodic:["[WEEKLY] Dust ledges, wall fixtures, lighting and vents.","[WEEKLY] Detail floor corners and trim in lounge and bathrooms.","[WEEKLY] Wipe down vending machine fronts.","[MONTHLY] Scrub bathroom floor grout and descale fixtures.","[MONTHLY] Spot clean walls and door frames."] },
    { key:"firstflooroffices", name:"1st Floor Offices (Carpet)", rounds:["5:00 AM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Vacuum all carpeting, wall to wall. (Aspire toda la alfombra, de pared a pared.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Detail vacuum carpet edges and under furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"bathrooms1st", name:"Bathrooms (1st Floor)", rounds:["5:00 AM"],
      every:["Check/empty trash. (Revise/vacíe la basura.)","Check paper towel, soap, and toilet paper dispensers. (Revise los dispensadores de toallas de papel, jabón y papel higiénico.)","Wipe down countertops. (Limpie los mostradores.)","Spot clean mirrors and splash marks. (Limpie las manchas de espejos y salpicaduras.)","Clean and sanitize inside and outside of toilets and urinals. (Limpie y desinfecte los inodoros y urinarios.)","Wipe down/sanitize stall handles and toilet paper holders. (Limpie/desinfecte las manijas de los cubículos y los soportes de papel.)","Remove splash marks from walls around basins, toilets, urinals and partitions. (Elimine las salpicaduras de las paredes.)","Sanitize all sink basins, polish bright work. (Desinfecte todos los lavabos, pula los elementos brillantes.)","Clean and polish mirrors. (Limpie y pula los espejos.)","Wipe paper towel cabinet cover. (Limpie la cubierta del gabinete de toallas de papel.)","Sweep/mop the floor. (Barra/trapee el piso.)","Empty sanitary napkin receptacles and damp wipe with disinfectant. (Vacíe los recipientes para toallas sanitarias y limpie con desinfectante.)"],
      periodic:["[WEEKLY] Dust/wipe down top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Detail floor corners and trim.","[MONTHLY] Scrub floor and wall grout.","[MONTHLY] Descale urinals, toilets and fixtures.","[MONTHLY] Clean and disinfect vent covers and light diffusers."] },
    { key:"conferenceroom", name:"Conference Room (1st Floor)", rounds:["5:00 AM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Reset conference room chairs and table. (Reacomode las sillas y la mesa.)","Vacuum all carpeting, wall to wall. (Aspire toda la alfombra, de pared a pared.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)","Clean whiteboards and wipe AV/conference equipment surfaces. (Limpie los pizarrones y el equipo audiovisual.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Detail vacuum carpet edges and under furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"trainingrooms", name:"Training Rooms (2nd Floor)", rounds:["6:00 AM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Reset training room tables and chairs. (Reacomode mesas y sillas de las salas de capacitación.)","Vacuum all carpeting, wall to wall. (Aspire toda la alfombra, de pared a pared.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)","Clean whiteboards. (Limpie los pizarrones.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Detail vacuum carpet edges and under furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"halls2nd", name:"Halls (2nd Floor)", rounds:["6:00 AM"],
      every:["Empty all trash cans and replace liners. (Vacíe todos los botes de basura y cambie las bolsas.)","Police halls for debris and remove. (Recoja la basura y los escombros de los pasillos.)","Spot clean spills. (Limpie los derrames.)","Sweep/dust mop all hall floors. (Barra/trapee en seco todos los pisos de los pasillos.)","Mop hall floors. (Trapee los pisos de los pasillos.)","Sanitize door handles and push plates. (Desinfecte las manijas y placas de empuje de las puertas.)","Sanitize trash can lids and exteriors. (Desinfecte las tapas y exteriores de los botes de basura.)"],
      periodic:["[WEEKLY] Dust high ledges, wall fixtures and HVAC vents.","[WEEKLY] Detail floor edges and corners.","[WEEKLY] Wash out trash cans.","[MONTHLY] Spot clean walls and door frames."] },
    { key:"hroffices", name:"HR Offices (Carpet)", rounds:["6:00 AM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Vacuum all carpeting, wall to wall. (Aspire toda la alfombra, de pared a pared.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Detail vacuum carpet edges and under furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"elevators", name:"Elevators", rounds:["8:00 AM"],
      every:["Police elevator cabs for debris. (Recoja la basura de los elevadores.)","Sanitize elevator buttons and interior handrails. (Desinfecte los botones y pasamanos interiores.)","Spot clean door glass and remove fingerprints. (Limpie el vidrio de las puertas y elimine las huellas.)","Vacuum or mop elevator cab floors as applicable. (Aspire o trapee los pisos del elevador.)","Wipe down interior walls and door tracks. (Limpie las paredes interiores y los rieles de las puertas.)","Polish stainless surfaces in cabs. (Pula las superficies de acero inoxidable.)"],
      periodic:["[WEEKLY] Detail door tracks and thresholds.","[WEEKLY] Dust cab ceiling vents and light diffusers.","[MONTHLY] Detail clean cab floor edges and corners."] },
    { key:"ptroom", name:"PT Room & EHS Office", rounds:["2:00 PM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Sanitize PT equipment contact surfaces. (Desinfecte las superficies de contacto del equipo de terapia.)","Sweep and mop all hard surface floors. (Barra y trapee todos los pisos de superficie dura.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"maintenanceoffices", name:"Maintenance Offices", rounds:["6:00 PM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Sweep and mop all hard surface floors. (Barra y trapee todos los pisos de superficie dura.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"warehousemanagers", name:"Warehouse Managers Offices", rounds:["6:00 PM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Vacuum all carpeting, wall to wall. (Aspire toda la alfombra, de pared a pared.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Detail vacuum carpet edges and under furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"qalab", name:"QA Lab", sub:"Do not disturb equipment or samples.", rounds:["6:00 PM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Sweep and mop lab floors; do not disturb equipment or samples. (Barra y trapee los pisos del laboratorio; no toque el equipo ni las muestras.)","Sanitize door handles and light switches. (Desinfecte manijas de puertas e interruptores de luz.)","Wipe down and disinfect cleared counters and tables only. (Limpie y desinfecte únicamente mostradores y mesas despejados.)","Dust cleared horizontal surfaces. (Quite el polvo de superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Detail floor edges and corners.","[MONTHLY] Spot clean walls and door frames."] },
    { key:"reception", name:"Reception", sub:"Do not clean 6:00 AM to 6:00 PM.", rounds:["9:00 PM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Straighten seating and reading material. (Ordene los asientos y el material de lectura.)","Empty out coffee machine spill tray. (Vacíe la bandeja recogegotas de la cafetera.)","Vacuum carpet and floor mats. (Aspire la alfombra y los tapetes.)","Sweep and mop hard surface floors. (Barra y trapee los pisos de superficie dura.)","Clean interior and exterior entry glass, remove fingerprints. (Limpie el vidrio de entrada interior y exterior.)","Sanitize door handles, push plates and light switches. (Desinfecte manijas, placas de empuje e interruptores.)","Wipe and disinfect reception counter, tables and seating. (Limpie y desinfecte el mostrador de recepción, mesas y asientos.)"],
      periodic:["[WEEKLY] Dust top ledges, wall fixtures, lighting, vents and artwork frames.","[WEEKLY] Spot clean walls.","[MONTHLY] Detail vacuum carpet edges and under furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"culinarycenter", name:"Culinary Center", sub:"Do not clean 6:00 AM to 6:00 PM.", rounds:["10:00 PM"],
      every:["Confirm outside business hours before cleaning, after 6:00 PM. (Confirme que está fuera del horario comercial, después de las 6:00 PM.)","Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Wipe down/sanitize counters and tables. (Limpie/desinfecte mostradores y mesas.)","Sanitize all sink basins and polish bright work. (Desinfecte todos los lavabos y pula elementos brillantes.)","Clean and sanitize appliance exteriors. (Limpie y desinfecte los exteriores de los electrodomésticos.)","Sweep and mop hard surface floors. (Barra y trapee los pisos de superficie dura.)","Spot clean glass and stainless. (Limpie manchas de vidrio y acero inoxidable.)","Sanitize door handles and light switches. (Desinfecte manijas e interruptores.)","Damp wipe/sanitize seating. (Limpie con paño húmedo/desinfecte los asientos.)"],
      periodic:["[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Detail floor corners and trim.","[WEEKLY] Wipe cabinet fronts, tops and sides.","[MONTHLY] Deep clean appliance exteriors and polish stainless."] },
    { key:"warehouseoffices", name:"Warehouse Offices", rounds:["11:00 PM"],
      every:["Check/empty trash and replace liners. (Revise/vacíe la basura y cambie las bolsas.)","Spot clean spills. (Limpie los derrames.)","Spot clean glass and remove fingerprints. (Limpie el vidrio y elimine las huellas.)","Sweep and mop all hard surface floors. (Barra y trapee todos los pisos de superficie dura.)","Sanitize door handles and light switches. (Desinfecte las manijas de puertas e interruptores de luz.)","Wipe surfaces: desks, tables, counters, seating. (Limpie superficies: escritorios, mesas, mostradores, asientos.)","Dust cleared horizontal surfaces. (Quite el polvo de las superficies horizontales despejadas.)"],
      periodic:["[WEEKLY] Spot clean walls and door frames.","[WEEKLY] Dust top ledges, wall fixtures, lighting and HVAC vents.","[WEEKLY] Dust fronts, tops and sides of furniture.","[MONTHLY] Dust blinds and window sills."] },
    { key:"deepcleaning", name:"Deep Cleaning", sub:"Describe exactly what was deep cleaned and where.", rounds:["10:00 AM"], freeText:true, every:[], periodic:[] }
  ];
  function areaByKey(key){ key = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, ""); for(var i = 0; i < AREAS.length; i++) if(AREAS[i].key === key) return AREAS[i]; return null; }
  function areaOptions(){
    var html = '<option value="">Pick the area</option>';
    AREAS.forEach(function(a){ html += '<option value="' + esc(a.key) + '">' + esc(a.name) + '</option>'; });
    return html;
  }

  function ls(fn){ try { return fn(); } catch(e){ return null; } }
  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function uid(prefix){ return prefix + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }
  function $(id){ return document.getElementById(id); }
  function params(){
    var out = {};
    (location.search || "").replace(/^\?/, "").split("&").forEach(function(p){
      if(!p) return; var i = p.indexOf("=");
      out[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = decodeURIComponent(i < 0 ? "" : p.slice(i + 1).replace(/\+/g, " "));
    });
    return out;
  }

  /* ---------- client gate ---------- */
  function touch(){ ls(function(){ localStorage.setItem(STAMP, String(Date.now())); }); }
  function fresh(){
    var t = Number(ls(function(){ return localStorage.getItem(STAMP); }) || 0);
    if(!t){ touch(); return true; }
    if(Date.now() - t > MAXAGE) return false;
    touch(); return true;
  }
  function getPass(){
    var v = ls(function(){ return localStorage.getItem(KEY); }) || "";
    if(v && !fresh()){ clearPass(); v = ""; }
    return v;
  }
  function setPass(p){ ls(function(){ localStorage.setItem(KEY, p); }); touch(); }
  function clearPass(){ ls(function(){ localStorage.removeItem(KEY); localStorage.removeItem(STAMP); }); }
  function getTeam(){ return ls(function(){ return localStorage.getItem(TEAMKEY); }) || ""; }
  function isTeam(){ return !!getTeam(); }

  function post(body){
    return fetch(WEBHOOK, { method:"POST", headers:{ "Content-Type":"text/plain" }, body: JSON.stringify(body) })
      .then(function(r){ return r.json(); });
  }
  function api(kind, body){
    body = body || {};
    body.kind = kind;
    if(!body.passcode) body.passcode = getPass();
    return post(body);
  }
  /* Team calls carry the device's team unlock (cw-auth.js). The server checks it against KH_TEAM_PASSCODE. */
  function teamApi(kind, body){ body = body || {}; body.kind = kind; body.passcode = getTeam(); return post(body); }
  function validate(pass){
    return post({ kind:"kh_auth", passcode: pass })
      .then(function(r){ if(r && r.ok === true) return { ok:true, r:r }; return { ok:false, r:r }; })
      .catch(function(){ return { ok:null }; });
  }
  function gateCore(opts, prefix, get, set, clear, check){
    var p = params();
    var next = p.next && p.next.indexOf(prefix) === 0 ? p.next : "";
    var input = $(opts.input), button = $(opts.button), err = $(opts.err), gate = $(opts.gate), app = $(opts.app);
    function say(m){ if(err) err.textContent = m || ""; }
    function open(){ if(next){ location.replace(next); return; } if(gate) gate.classList.add("hidden"); if(app) app.classList.remove("hidden"); if(opts.onUnlock) opts.onUnlock(); }
    function submit(){
      var v = input ? String(input.value || "").trim() : "";
      if(!v){ say("Enter the passcode."); return; }
      button.disabled = true; button.textContent = "Checking...";
      check(v).then(function(res){
        button.disabled = false; button.textContent = "Enter";
        if(res.ok === true){ set(v); open(); }
        else if(res.ok === null) say("Could not reach the server. Check your connection and try again.");
        else { say((res.r && res.r.error && !/wrong/i.test(res.r.error)) ? res.r.error : "That passcode is not right. Ask your City Wide contact."); input.value = ""; input.focus(); }
      });
    }
    if(button) button.addEventListener("click", function(e){ e.preventDefault(); submit(); });
    if(input) input.addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); submit(); } });
    var cached = get();
    if(cached){
      if(next){ check(cached).then(function(res){ if(res.ok === true || res.ok === null) open(); else { clear(); if(input) input.focus(); } }); }
      else { open(); check(cached).then(function(res){ if(res.ok === false){ clear(); location.reload(); } }); }
    } else if(input) input.focus();
  }
  function hubGate(opts){ gateCore(opts, HUB, getPass, setPass, clearPass, validate); }
  function require(){
    var pass = getPass();
    if(!pass){ location.replace(HUB + "?next=" + encodeURIComponent(location.href)); return ""; }
    return pass;
  }
  function locked(msg){
    if(!msg || /passcode/i.test(String(msg))){ clearPass(); location.replace(HUB + "?next=" + encodeURIComponent(location.href)); return; }
    alert(msg);
  }

  /* ---------- Manager Desk gate ---------- */
  var MGRKEY = "cwKensMgrPass", MGRSTAMP = "cwKensMgrSince", MGRHUB = HUB + "manager.html";
  function mgrTouch(){ ls(function(){ localStorage.setItem(MGRSTAMP, String(Date.now())); }); }
  function mgrGetPass(){
    var v = ls(function(){ return localStorage.getItem(MGRKEY); }) || "";
    var t = Number(ls(function(){ return localStorage.getItem(MGRSTAMP); }) || 0);
    if(v && t && Date.now() - t > MAXAGE){ mgrClearPass(); return ""; }
    if(v) mgrTouch();
    return v;
  }
  function mgrSetPass(p){ ls(function(){ localStorage.setItem(MGRKEY, p); }); mgrTouch(); }
  function mgrClearPass(){ ls(function(){ localStorage.removeItem(MGRKEY); localStorage.removeItem(MGRSTAMP); }); }
  function mgrApi(kind, body){ body = body || {}; body.kind = kind; body.passcode = mgrGetPass(); return post(body); }
  function mgrValidate(pass){
    return post({ kind:"kh_mgr_auth", passcode: pass })
      .then(function(r){ if(r && r.ok === true) return { ok:true, r:r }; return { ok:false, r:r }; })
      .catch(function(){ return { ok:null }; });
  }
  function mgrGate(opts){ gateCore(opts, HUB + "manager", mgrGetPass, mgrSetPass, mgrClearPass, mgrValidate); }
  function mgrRequire(){
    var pass = mgrGetPass();
    if(!pass){ location.replace(MGRHUB + "?next=" + encodeURIComponent(location.href)); return ""; }
    return pass;
  }
  function mgrLocked(msg){
    if(!msg || /passcode/i.test(String(msg))){ mgrClearPass(); location.replace(MGRHUB + "?next=" + encodeURIComponent(location.href)); return; }
    alert(msg);
  }

  /* ---------- photos ---------- */
  function shrink(file, max, quality){
    max = max || 1280; quality = quality || 0.74;
    function draw(src, w, h){
      var s = Math.min(1, max / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      var c = document.createElement("canvas"); c.width = cw; c.height = ch;
      var ctx = c.getContext("2d"); ctx.drawImage(src, 0, 0, cw, ch);
      return { data: c.toDataURL("image/jpeg", quality), w: cw, h: ch };
    }
    if(window.createImageBitmap){
      return createImageBitmap(file, { imageOrientation: "from-image" }).then(function(bm){
        var out = draw(bm, bm.width, bm.height); try { bm.close(); } catch(e){} return out;
      }).catch(function(){ return viaImage(); });
    }
    return viaImage();
    function viaImage(){
      return new Promise(function(res, rej){
        var url = URL.createObjectURL(file); var img = new Image();
        img.onload = function(){ try { res(draw(img, img.naturalWidth, img.naturalHeight)); } catch(e){ rej(e); } URL.revokeObjectURL(url); };
        img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error("Could not read that photo")); };
        img.src = url;
      });
    }
  }
  function thumb(data, max){
    max = max || 240;
    return new Promise(function(res){
      var img = new Image();
      img.onload = function(){
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = function(){ res(data); };
      img.src = data;
    });
  }
  /* Upload photos one at a time. list = [{pid, data}], onEach(i, n, ok). Resolves count failed. */
  function uploadPhotos(id, list, onEach, apiFn){
    var failed = 0, call = apiFn || api;
    return list.reduce(function(chain, p, i){
      return chain.then(function(){
        if(p.uploaded) { if(onEach) onEach(i, list.length, true); return; }
        return call("kh_photo_put", { id:id, pid:p.pid, data:p.data }).then(function(r){
          if(r && r.ok){ p.uploaded = true; p.fileId = r.fileId; } else failed++;
          if(onEach) onEach(i, list.length, !!(r && r.ok));
        }).catch(function(){ failed++; if(onEach) onEach(i, list.length, false); });
      });
    }, Promise.resolve()).then(function(){ return failed; });
  }

  /* ---------- drafts (phone first) ---------- */
  function draftKey(kind){ return "cwKhDraft_" + kind; }
  function saveDraft(kind, obj){ ls(function(){ localStorage.setItem(draftKey(kind), JSON.stringify(obj)); }); }
  function loadDraft(kind){ var s = ls(function(){ return localStorage.getItem(draftKey(kind)); }); if(!s) return null; try { return JSON.parse(s); } catch(e){ return null; } }
  function clearDraft(kind){ ls(function(){ localStorage.removeItem(draftKey(kind)); }); }
  var DB = null;
  function idb(){
    if(DB) return Promise.resolve(DB);
    return new Promise(function(res, rej){
      if(!window.indexedDB) return rej(new Error("no idb"));
      var req = indexedDB.open("cwKensHub", 1);
      req.onupgradeneeded = function(){ var db = req.result; if(!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath:"key" }); };
      req.onsuccess = function(){ DB = req.result; res(DB); };
      req.onerror = function(){ rej(req.error); };
    });
  }
  function photoStore(key, data){ return idb().then(function(db){ return new Promise(function(res){ var tx = db.transaction("photos", "readwrite"); tx.objectStore("photos").put({ key:key, data:data, at:Date.now() }); tx.oncomplete = function(){ res(true); }; tx.onerror = function(){ res(false); }; }); }).catch(function(){ return false; }); }
  function photoLoad(key){ return idb().then(function(db){ return new Promise(function(res){ var r = db.transaction("photos").objectStore("photos").get(key); r.onsuccess = function(){ res(r.result ? r.result.data : null); }; r.onerror = function(){ res(null); }; }); }).catch(function(){ return null; }); }
  function photoDrop(prefix){ return idb().then(function(db){ return new Promise(function(res){ var st = db.transaction("photos", "readwrite").objectStore("photos"); var c = st.openCursor(); c.onsuccess = function(){ var cur = c.result; if(!cur) return res(true); if(String(cur.key).indexOf(prefix) === 0) cur.delete(); cur.continue(); }; c.onerror = function(){ res(false); }; }); }).catch(function(){ return false; }); }

  function fmtDate(iso){
    if(!iso) return "";
    var d = new Date(iso); if(isNaN(d)) return String(iso);
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) + " " + d.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
  }
  function fmtTime(iso){ var d = new Date(iso); if(isNaN(d)) return String(iso || ""); return d.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" }); }
  function weekday(ymd){
    if(!ymd) return "";
    var p = ymd.split("-"); var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()] || "";
  }
  function niceDay(ymd){ if(!ymd) return ""; var p = ymd.split("-"); var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); return d.toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric" }); }
  function today(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function porterName(v){ if(v !== undefined){ ls(function(){ localStorage.setItem("cwKhPorter", v || ""); }); return v; } return ls(function(){ return localStorage.getItem("cwKhPorter"); }) || ""; }

  /* Shared photo picker for any page: wires a hidden <input type=file> to a callback with { pid, thumb, data }. */
  function photoPick(inputId, onPhoto, onErr){
    var inp = $(inputId);
    inp.addEventListener("change", function(){
      var f = inp.files && inp.files[0]; if(!f) return;
      shrink(f, 1280, 0.74).then(function(r){
        var pid = uid("ph_");
        return thumb(r.data, 240).then(function(t){ onPhoto({ pid:pid, w:r.w, h:r.h, at:new Date().toISOString(), thumb:t, data:r.data }); });
      }).catch(function(){ if(onErr) onErr("Could not read that photo. Try again."); });
    });
    return function(){ inp.value = ""; inp.click(); };
  }

  /* One site only. Pages cloned from the Ovation Hub still ask for a property; these shims answer with the plant. */
  function propertyOptions(){ return '<option value="' + esc(SITE) + '" selected>' + esc(SITE) + '</option>'; }
  function porterProp(){ return SITE; }
  function byName(){ return { name:SITE, type:"plant" }; }
  window.KH = { propertyOptions:propertyOptions, porterProp:porterProp, byName:byName, WEBHOOK:WEBHOOK, HUB:HUB, LOGO:LOGO, KLOGO:KLOGO, SITE:SITE, SHIFTS:SHIFTS, AREAS:AREAS,
    shiftFor:shiftFor, shiftNow:shiftNow, areaByKey:areaByKey, areaOptions:areaOptions,
    esc:esc, uid:uid, $:$, params:params,
    getPass:getPass, setPass:setPass, clearPass:clearPass, getTeam:getTeam, isTeam:isTeam, post:post, api:api, teamApi:teamApi, validate:validate, hubGate:hubGate, require:require, locked:locked,
    mgrGate:mgrGate, mgrRequire:mgrRequire, mgrApi:mgrApi, mgrLocked:mgrLocked, mgrGetPass:mgrGetPass, mgrClearPass:mgrClearPass, MGRHUB:MGRHUB,
    shrink:shrink, thumb:thumb, uploadPhotos:uploadPhotos, photoPick:photoPick, saveDraft:saveDraft, loadDraft:loadDraft, clearDraft:clearDraft,
    photoStore:photoStore, photoLoad:photoLoad, photoDrop:photoDrop, fmtDate:fmtDate, fmtTime:fmtTime, weekday:weekday, niceDay:niceDay, today:today, porterName:porterName };
})();
