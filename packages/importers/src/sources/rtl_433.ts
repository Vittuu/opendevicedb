// rtl_433 decoders: every src/devices/*.c file of github.com/merbanan/rtl_433 defines one or
// more `r_device const x = { .name = "…", … }` structs, one per reverse-engineered 315/345/
// 433/868/915 MHz radio protocol. The name is free text, often a list of the models sharing
// the protocol ("Acurite 606TX / Technoline TX960 Temperature Sensor", "Nexus, FreeTec
// NC-7345, NX-3980, … sensor"). It is split into vendor + model pairs: a model is a run of
// model-number tokens, a segment that starts with a brand switches vendor, and a slash list
// ("ET-732/733") expands. Names that are protocol families rather than devices (ERT, Wireless
// M-Bus, KeeLoq encoders, "Generic …") are skipped; a short table fixes names the rules
// cannot read.
//
// Status: receiving what the device transmits is the whole function of a sensor, meter or
// one-way remote, so a working decoder makes it `controllable`. It is `partial-protocol`
// when rtl_433 only sees one side of a larger system or cannot read the whole message:
// car keys and keyfobs with rolling or encrypted codes, thermostats and heating controls
// (their receiver is not driven), alarm systems, bidirectional devices, and decoders whose
// own comment says the payload is undecoded or unconfirmed.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, firstMatch, githubFiles, githubRaw, mapLimit, deviceFirmwareFreedom, type Source } from "../lib.ts";

const REPO = "merbanan/rtl_433", BRANCH = "master";
const DECODER_FILE = /^src\/devices\/[^/]+\.c$/;
const LICENSE = "GPL-2.0-or-later";

export interface Decoder { name: string; disabled: number; note: string }

/** The r_device structs of one decoder source file. */
export function extractDecoders(text: string): Decoder[] {
  const out: Decoder[] = [];
  const block = /\br_device\s+(?:const\s+)?\w+\s*=\s*\{([\s\S]*?)\};/g;
  for (const m of text.matchAll(block)) {
    const name = m[1].match(/\.name\s*=\s*"((?:[^"\\]|\\.)*)"/)?.[1];
    if (!name) continue;
    const dis = m[1].match(/\.disabled\s*=\s*(\d+)\s*,?\s*(?:\/\/\s*(.*))?/);
    out.push({ name: clean(name.replace(/\\"/g, '"')), disabled: dis ? Number(dis[1]) : 0, note: clean(dis?.[2] ?? "") });
  }
  return out;
}

// ---------- vendors ----------

// Canonical spelling of brands, keyed by lowercase spelling (multi-word brands included).
const BRANDS: Record<string, string> = Object.fromEntries(([
  ["acurite", "AcuRite"], ["ambient weather", "Ambient Weather"], ["ambientweather", "Ambient Weather"],
  ["fine offset electronics", "Fine Offset"], ["fine offset", "Fine Offset"], ["fineoffset", "Fine Offset"],
  ["ecowitt", "Ecowitt"], ["froggit", "Froggit"], ["misol", "Misol"], ["telldus", "Telldus"],
  ["tfa dostmann", "TFA Dostmann"], ["tfa", "TFA Dostmann"], ["technoline", "Technoline"],
  ["lacrosse technology", "La Crosse Technology"], ["lacrosse", "La Crosse Technology"], ["la crosse", "La Crosse Technology"],
  ["oregon scientific", "Oregon Scientific"], ["oregon", "Oregon Scientific"],
  ["switchdoclabs", "SwitchDoc Labs"], ["switchdoc labs", "SwitchDoc Labs"],
  ["infactory", "inFactory"], ["nor-tec", "nor-tec"], ["freetec", "FreeTec"], ["pearl", "Pearl"],
  ["thermopro", "ThermoPro"], ["netatmo", "Netatmo"], ["emos", "EMOS"], ["hideki", "Hideki"],
  ["holman industries", "Holman"], ["holman", "Holman"], ["aok", "AOK"], ["conrad", "Conrad"],
  ["optex", "Optex"], ["biowin", "BIOWIN"], ["altronics", "Altronics"], ["orium", "Orium"],
  ["newentor", "Newentor"], ["otio", "Otio"], ["protmex", "Protmex"], ["jula", "Jula"], ["technisat", "TechniSat"],
  ["solight", "Solight"], ["oria", "ORIA"], ["rubicson", "Rubicson"], ["sempre", "Sempre"], ["auriol", "Auriol"],
  ["ventus", "Ventus"], ["alecto", "Alecto"], ["bresser", "Bresser"], ["explore scientific", "Explore Scientific"],
  ["globaltronics", "Globaltronics"], ["quigg", "QUIGG"], ["chaney", "Chaney"], ["gevanti", "Gevanti"], ["sainlogic", "Sainlogic"],
  ["the weather channel", "The Weather Channel"], ["motonet", "Motonet"], ["marquant", "MarQuant"], ["ade", "ADE"],
  ["schou", "Schou"], ["ea2", "Ea2"], ["eurochron", "Eurochron"], ["nexus", "Nexus"], ["prologue", "Prologue"],
  ["baldr", "Baldr"], ["rainpoint", "RainPoint"], ["homgar", "HomGar"], ["geevon", "Geevon"], ["homelead", "Homelead"],
  ["landis & gyr", "Landis+Gyr"], ["badger meter", "Badger Meter"], ["badger", "Badger Meter"],
  ["master meter", "Master Meter"], ["arad", "Arad"], ["elster", "Elster"], ["honeywell", "Honeywell"],
  ["neptune", "Neptune"], ["mueller", "Mueller"], ["apator", "Apator"],
  ["amazon basics", "Amazon Basics"], ["blueline innovations", "BlueLine Innovations"], ["code alarm", "Code Alarm"],
  ["cellular tracking technologies", "Cellular Tracking Technologies"], ["silent gliss", "Silent Gliss"],
  ["royal gardineer", "Royal Gardineer"], ["dr.meter", "Dr.Meter"], ["kingspan", "Kingspan"], ["watchman", "Watchman"],
  ["sensible living", "Sensible Living"], ["smartfire", "SmartFire"], ["gear hive", "Gear Hive"],
  ["mercedes benz", "Mercedes-Benz"], ["shenzhen wale", "Wale"], ["shenzhen egq", "EGQ"],
  ["opus", "Opus"], ["imagintronix", "Imagintronix"], ["jasco", "Jasco"], ["ge", "GE"],
  ["proove", "Proove"], ["nexa", "Nexa"], ["klikaanklikuit", "KlikAanKlikUit"],
  ["markisol", "Markisol"], ["e-motion", "E-Motion"], ["bofu", "BOFU"], ["rollerhouse", "Rollerhouse"],
  ["schrader", "Schrader"], ["redi-sensor", "Redi-Sensor"], ["jansite", "Jansite"], ["kkmoon", "KKMOON"],
  ["sefis", "Sefis"], ["careud", "Careud"], ["sykik", "Sykik"], ["eeztire", "EezTire"], ["carchet", "Carchet"],
  ["2gig", "2GIG"], ["kedsum", "Kedsum"], ["vauno", "Vauno"], ["tekelek", "Tekelek"], ["infiniti", "Infiniti"],
  ["thermor", "Thermor"], ["emontx", "OpenEnergyMonitor"], ["voltcraft", "Voltcraft"], ["dsc", "DSC"], ["elv", "ELV"],
  ["govee", "Govee"], ["inkbird", "Inkbird"], ["vevor", "Vevor"], ["kidde", "Kidde"], ["somfy", "Somfy"],
  ["currentcost", "Current Cost"], ["ikea", "IKEA"], ["deltadore", "Delta Dore"], ["netatmo", "Netatmo"],
] as [string, string][]));

const brandAt = (words: string[], i: number): { brand: string; len: number } | null => {
  for (let len = Math.min(4, words.length - i); len >= 1; len--) {
    const k = words.slice(i, i + len).join(" ").toLowerCase().replace(/[,.]$/, "");
    if (BRANDS[k]) return { brand: BRANDS[k], len };
  }
  return null;
};
const canonical = (v: string) => BRANDS[v.toLowerCase()] ?? v;

// ---------- tokens ----------

// Words that describe what a device is rather than which one it is.
const DESCRIPTORS = new Set(`a an the and or with for of from by to in on plus based series type devices device models model
  temperature temp humidity hum thermo hygro thermo-hygrometer hygrometer thermometer thermometers thermal sensor sensors probe probes
  weather station stations wetterstation center rain rainfall gauge wind anemometer lightning lightning-strike pressure
  leak leakage water flood smoke heat co alarm detector door window contact pir pet motion multi multisensor
  soil moisture light level air quality pool spa sauna bbq grill meat smoker fridge freezer refrigerator dual four two-channel channel
  meter meters power energy current monitor cost utility flow oil tank ultrasonic liquid battery battery-less solar
  remote control controller controllers car key keyfob fob keyless entry garage gate gates blinds awning curtain shutter doorbell
  wireless outdoor indoor digital smart radio-controlled programmable room floor heating underfloor central thermostat
  switch transmitter socket wall ceiling fan home security system protect panel sensor. timer shot cricket scoreboard
  optional new older id only mode rebrand also aka collides
  tpms pm pm2.5 pm10 co2 hcho voc lcd usb dcf dcf77 fsk ook ask pwm mc oem pv rf hi lo eu us uk ec`.split(/\s+/));

const NUMBERISH = /^(\d+(\.\d+)?(v|k|kbps|mhz|hz|m|bit\/s)|\d{1,2})$/i;
const isDescriptor = (w: string) => DESCRIPTORS.has(w.toLowerCase().replace(/[,.:;]+$/, "")) || /^[a-z]+(\/[a-z-]+)+$/i.test(w) && w.split("/").every((p) => DESCRIPTORS.has(p.toLowerCase().replace(/-$/, "")) || p === "");
/** A model-number-like token: has a digit, or is an all-caps code. */
const isModelToken = (w: string) => !isDescriptor(w) && !/^\d{1,2}$/.test(w) && !NUMBERISH.test(w) && (/\d/.test(w) || /^[A-Z][A-Z-]{1,}[A-Z]$/.test(w));
const isCapWord = (w: string) => /^[A-Z][a-zA-Z.+-]*$/.test(w) && !isDescriptor(w);

/** "ET-732/733" → ET-732, ET-733; "990040/50/51" → 990040, 990050, 990051; "WN34S/L/D" → WN34S, WN34L, WN34D. */
export function expandSlashes(token: string): string[] {
  const parts = token.split("/").filter(Boolean);
  if (parts.length < 2) return [token];
  const out = [parts[0]];
  for (const p of parts.slice(1)) {
    const prev = out[out.length - 1];
    if (p.length < prev.length && (/^\d+[a-z]?$/i.test(p) || /^[A-Z]$/.test(p))) out.push(prev.slice(0, prev.length - p.length) + p);
    else out.push(p);
  }
  return out;
}

// ---------- names ----------

export interface Pair { vendor: string; model: string }

// Names the rules cannot read: exact cleaned name → pairs (empty = skip).
export const OVERRIDES: Record<string, [string, string][]> = {
  "AlectoV1 Weather Sensor (Alecto WS3500 WS4500 Ventus W155/W044 Oregon)": [["Alecto", "WS3500"], ["Alecto", "WS4500"], ["Ventus", "W155"], ["Ventus", "W044"]],
  "Ambient Weather WH31L (FineOffset WH57) Lightning-Strike sensor": [["Ambient Weather", "WH31L"], ["Fine Offset", "WH57"]],
  "Orion Endpoint from Badger Meter, GIF2014W-OSE, water meter, hopping from 904.4 Mhz to 924.6Mhz (-s 1600k)": [["Badger Meter", "Orion Endpoint GIF2014W-OSE"]],
  "Orion Endpoint from Badger Meter, GIF2020OCECNA, water meter, hopping from 904.4 Mhz to 924.6Mhz (-s 1600k)": [["Badger Meter", "Orion Endpoint GIF2020OCECNA"]],
  "Badger ORION water meter, 100kbps (-f 916.45M -s 1200k)": [["Badger Meter", "ORION"]],
  "TBH weather sensor": [], // TBH project protocol, several device types
  "Atech-WS308 temperature sensor": [["Atech", "WS308"]],
  "ThermoPro-TX2 temperature sensor": [["ThermoPro", "TX2"]],
  "RojaFlex shutter and remote devices": [["RojaFlex", "Shutter"], ["RojaFlex", "Remote"]],
  "TFA Marbella Pool Thermometer": [["TFA Dostmann", "Marbella"]],
  "Klimalogg": [["TFA Dostmann", "KlimaLogg Pro"]],
  "OSv1 Temperature Sensor": [["Oregon Scientific", "v1 Temperature Sensor"]],
  "bm5-v2 12V Battery Monitor": [],
  "Nexus, CRX, Prego sauna temperature sensor": [["Nexus", "Sauna Temperature Sensor"]],
  "Inovalley kw9015b, TFA Dostmann 30.3161 (Rain and temperature sensor)": [["Inovalley", "kw9015b"], ["TFA Dostmann", "30.3161"]],
  "Elantra2012 TPMS": [["Hyundai", "Elantra 2012 TPMS"]],
  "Honda (TRW PPA-GF33) TPMS": [["Honda", "TPMS"], ["TRW", "PPA-GF33"]],
  "PMV-107J (Toyota) TPMS": [["Pacific Industries", "PMV-107J"]],
  "TRW TPMS OOK OEM and Clone models": [["TRW", "TPMS"]],
  "TRW TPMS FSK OEM and Clone models": [["TRW", "TPMS"]],
  "Abarth 124 Spider and Shenzhen EGQ Q85 TPMS": [["Abarth", "124 Spider TPMS"], ["EGQ", "Q85"]],
  "BMW Gen4-Gen5 TPMS and Audi TPMS Pressure Alert, multi-brand HUF/Beru, Continental, Schrader/Sensata, Audi": [["BMW", "Gen4-Gen5 TPMS"], ["Audi", "TPMS Pressure Alert"]],
  "BMW Gen2 and Gen3 TPMS": [["BMW", "Gen2-Gen3 TPMS"]],
  "SmarTire TPMS sensor, Aston Martin/Vantage DB9 protocol": [["SmarTire", "TPMS"]],
  "Unbranded SolarTPMS for trucks": [["Generic", "Solar TPMS for trucks"]],
  "Mercedes Benz Sprinter 4500 TPMS sensor": [["Mercedes-Benz", "Sprinter 4500 TPMS"]],
  "Schrader TPMS EG53MA4, Saab, Opel, Vauxhall, Chevrolet": [["Schrader", "EG53MA4"]],
  "Schrader TPMS SMD3MA4 (Subaru)": [["Schrader", "SMD3MA4"]],
  "Schrader TPMS MRXNIS315G3, 3039 (Infiniti, Nissan, Renault), aka Redi-Sensor SE10001HP/SE10001HPR": [["Schrader", "MRXNIS315G3"], ["Schrader", "3039"], ["Redi-Sensor", "SE10001HP"], ["Redi-Sensor", "SE10001HPR"]],
  "Schrader TPMS MRXBC5A4 (BMW)": [["Schrader", "MRXBC5A4"]],
  "Jansite TPMS Model Solar": [["Jansite", "Solar TPMS"]],
  "Jansite TPMS TY-468-eu2 / KKMOON TPMS": [["Jansite", "TY-468-eu2"], ["KKMOON", "TPMS"]],
  "Hyundai TPMS (VDO)": [["Hyundai", "TPMS (VDO)"]],
  "Honeywell Door/Window Sensor, 2Gig DW10/DW11, RE208 repeater": [["Honeywell", "Door/Window Sensor"], ["2GIG", "DW10"], ["2GIG", "DW11"], ["2GIG", "RE208"]],
  "Honeywell ActivLink, Wireless Doorbell": [["Honeywell", "ActivLink Wireless Doorbell"]],
  "Honeywell ActivLink, Wireless Doorbell (FSK)": [["Honeywell", "ActivLink Wireless Doorbell"]],
  "Fine Offset Electronics, WH2, WH5, Telldus Temperature/Humidity/Rain Sensor": [["Fine Offset", "WH2"], ["Fine Offset", "WH5"]],
  "Agimex Rosenborg 66796 (collides with Fine Offset Electronics WH5) Temperature/Humidity Sensor": [["Agimex", "Rosenborg 66796"]],
  "Funkbus / Instafunk (Berker, Gira, Jung)": [],
  "Rosstech Digital Control Unit DCU-706/Sundance/Jacuzzi": [["Rosstech", "DCU-706"]],
  "Watchman Sonic / Apollo Ultrasonic / Beckett Rocket oil tank monitor": [["Watchman", "Sonic"], ["Apollo", "Ultrasonic"], ["Beckett", "Rocket"]],
  "Watchman Sonic Advanced / Plus, Tekelek": [["Watchman", "Sonic Advanced"], ["Watchman", "Sonic Plus"]],
  "Kingspan/Watchman Plus (Niveau) oil tank monitor": [["Kingspan", "Watchman Plus"]],
  "Universal (Reverseable) 24V Fan Controller": [],
  "Wireless Smoke and Heat Detector GS 558": [["Siterwell", "GS 558"], ["VisorTech", "RWM-460.f"]],
  "RF-T0912 Grill Thermometer": [["Generic", "RF-T0912"]],
  "FT-004-B Temperature Sensor": [["Generic", "FT-004-B"]],
  "WT450, WT260H, WT405H": [["Generic", "WT450"], ["Generic", "WT260H"], ["Generic", "WT405H"]],
  "WG-PB12V1 Temperature Sensor": [["Generic", "WG-PB12V1"]],
  "WT0124 Pool Thermometer": [["Generic", "WT0124"]],
  "WS2032 weather station": [["Generic", "WS2032"]],
  "WEC-2103 temperature/humidity sensor": [["Generic", "WEC-2103"], ["Tchibo", "602012"]],
  "TS-FT002 Wireless Ultrasonic Tank Liquid Level Meter With Temperature Sensor": [["Generic", "TS-FT002"]],
  "TR-502MSV remote smart socket controller": [["Generic", "TR-502MSV"]],
  "HT680 Remote control": [["Generic", "HT680"]],
  "EN2058 four probe temperature sensor": [["Generic", "EN2058"]],
  "CED7000 Shot Timer": [["CED", "CED7000"], ["CED", "CED8000"]],
  "ESA1000 / ESA2000 Energy Monitor, GIRA Wetterstation": [["ELV", "ESA1000"], ["ELV", "ESA2000"]],
  "RFM69 LowPowerLab Moteino board (-s 1000k)": [["LowPowerLab", "Moteino"]],
  "Cotech FT0203/18-3676 anemometer": [["Cotech", "18-3676"]],
  "Fine Offset Electronics / Ecowitt WH52 Soil Moisture/Temperature/EC Sensor": [["Fine Offset", "WH52"], ["Ecowitt", "WH52"]],
  "Fine Offset / Ecowitt WH55 water leak sensor": [["Fine Offset", "WH55"], ["Ecowitt", "WH55"]],
  "Fine Offset Electronics/Ecowitt WH51, WN31, SwitchDoc Labs SM23 Soil Moisture Sensor": [["Fine Offset", "WH51"], ["Ecowitt", "WH51"], ["Ecowitt", "WN31"], ["SwitchDoc Labs", "SM23"]],
  "Hanwell ML/RL4000-series Radiologger temperature/humidity sensor": [["Hanwell", "ML4000"], ["Hanwell", "RL4000"]],
  "LaCrosse TX141-Bv2, TX141TH-Bv2, TX141-Bv3, TX141W, TX145wsdth, (TFA, ORIA) sensor": [["La Crosse Technology", "TX141-Bv2"], ["La Crosse Technology", "TX141TH-Bv2"], ["La Crosse Technology", "TX141-Bv3"], ["La Crosse Technology", "TX141W"], ["La Crosse Technology", "TX145wsdth"]],
  "Bresser Weather Center 6-in-1, 7-in-1 indoor, soil, new 5-in-1, 3-in-1 wind gauge, Froggit WH6000, Ventus C8488A": [["Bresser", "6-in-1"], ["Bresser", "3-in-1 wind gauge"], ["Froggit", "WH6000"], ["Ventus", "C8488A"]],
  "Bresser Weather Center 7-in-1, Air Quality PM2.5/PM10 7009970, CO2 7009977, HCHO/VOC 7009978 sensors": [["Bresser", "7-in-1"], ["Bresser", "7009970"], ["Bresser", "7009977"], ["Bresser", "7009978"]],
  "Bresser Weather Center 5-in-1": [["Bresser", "5-in-1"]],
  "Bresser SmartHome Garden soil moisture and water timer valve (Baldr Homgar, RainPoint)": [["Bresser", "SmartHome Garden soil moisture sensor"], ["Bresser", "SmartHome Garden water timer"]],
  "Acurite 592TXR temp/humidity, 592TX temp, 5n1, 3n1, Atlas weather station, 515 fridge/freezer, 6045 lightning, 899 rain, 1190/1192 leak":
    [["AcuRite", "592TXR"], ["AcuRite", "592TX"], ["AcuRite", "5-in-1"], ["AcuRite", "3-in-1"], ["AcuRite", "Atlas"], ["AcuRite", "515"], ["AcuRite", "6045"], ["AcuRite", "899"], ["AcuRite", "1190"], ["AcuRite", "1192"]],
  "Acurite 00275rm,00276rm Temp/Humidity with optional probe": [["AcuRite", "00275RM"], ["AcuRite", "00276RM"]],
  "Ambient Weather WH31E Thermo-Hygrometer Sensor, EcoWitt WH40/WN20 rain gauge, WS68 weather station": [["Ambient Weather", "WH31E"], ["Ecowitt", "WH40"], ["Ecowitt", "WN20"], ["Ecowitt", "WS68"]],
  "Digitech XC-0324 / AmbientWeather FT005TH temp/hum sensor": [["Digitech", "XC-0324"], ["Ambient Weather", "FT005TH"]],
  "Olympia Protect 9571 alarm system sensors": [["Olympia", "Protect 9571"]],
  "LaCrosse Technology View LTV-R1, LTV-R3 Rainfall Gauge, LTV-W1/W2 Wind Sensor": [["La Crosse Technology", "LTV-R1"], ["La Crosse Technology", "LTV-R3"], ["La Crosse Technology", "LTV-W1"], ["La Crosse Technology", "LTV-W2"]],
  "LaCrosse Technology View LTV-TH Thermo/Hygro Sensor": [["La Crosse Technology", "LTV-TH"]],
  "LaCrosse Technology View LTV-WSDTH01 Breeze Pro Wind Sensor": [["La Crosse Technology", "LTV-WSDTH01 Breeze Pro"]],
  "LaCrosse Technology View LTV-WR1 Multi Sensor": [["La Crosse Technology", "LTV-WR1"]],
  "LaCrosse WS6868 TX232TH-LCD temperature/humidity sensor": [["La Crosse Technology", "TX232TH-LCD"]],
  "LaCrosse WS6868 TX231RW wind/rain sensor": [["La Crosse Technology", "TX231RW"]],
  "LaCrosse TX Temperature / Humidity Sensor, TX5U rain gauge": [["La Crosse Technology", "TX5U"]],
  "LaCrosse/ELV/Conrad WS7000/WS2500 weather sensors": [["La Crosse Technology", "WS7000"], ["ELV", "WS2500"]],
  "ThermoPro Meat Thermometers, TP828B 2 probes with Temp, BBQ Target LO and HI": [["ThermoPro", "TP828B"]],
  "ThermoPro Meat Thermometers, TP829B 4 probes with temp only": [["ThermoPro", "TP829B"]],
  "ThermoPro TempSpike XR TP862b / TP863b Wireless Dual-Probe Meat Thermometer": [["ThermoPro", "TP862b"], ["ThermoPro", "TP863b"]],
  "AOK Weather Station rebrand Holman Industries iWeather WS5029, Conrad AOK-5056, Optex 990018": [["Holman", "iWeather WS5029"], ["Conrad", "AOK-5056"], ["Optex", "990018"]],
  "Holman Industries iWeather WS5029 weather station (older PWM)": [["Holman", "iWeather WS5029"]],
  "Holman Industries iWeather WS5029 weather station (older PWM, OOK), BIOWIN 270208": [["Holman", "iWeather WS5029"], ["BIOWIN", "270208"]],
  "Homelead HG9901 (Geevon, Dr.Meter, Royal Gardineer) soil moisture/temp/light level sensor": [["Homelead", "HG9901"]],
  "Marlec Solar iBoost+ sensors": [["Marlec", "Solar iBoost+"]],
  "Cellular Tracking Technologies LifeTag/PowerTag/HybridTag": [["Cellular Tracking Technologies", "LifeTag"], ["Cellular Tracking Technologies", "PowerTag"], ["Cellular Tracking Technologies", "HybridTag"]],
  "Elero bidirectional blinds/awning remote (Silent Gliss and others)": [["Elero", "Blinds/Awning Remote"]],
  "EcoDHOME Smart Socket and MCEE Solar monitor": [["EcoDHOME", "Smart Socket"], ["EcoDHOME", "MCEE Solar Monitor"]],
  "Eco-Eye solar PV/grid current monitor": [["Eco-Eye", "Solar PV/Grid Current Monitor"]],
  "emonTx OpenEnergyMonitor": [["OpenEnergyMonitor", "emonTx"]],
  "Opus/Imagintronix XT300 Soil Moisture": [["Opus", "XT300"], ["Imagintronix", "XT300"]],
  "Risco 2 Way Agility protocol, Risco PIR/PET Sensor RWX95P": [["Risco", "RWX95P"]],
  "Vivint Door/Window Sensor, V-DW21R-345/V-DW11-345": [["Vivint", "V-DW21R-345"], ["Vivint", "V-DW11-345"]],
  "Jasco/GE Choice Alert Security Devices": [["Jasco", "Choice Alert"]],
  "Interlogix GE UTC Security Devices": [],
  "Markisol, E-Motion, BOFU, Rollerhouse, BF-30x, BF-415 curtain remote": [["BOFU", "BF-30x"], ["BOFU", "BF-415"]],
  "Proove / Nexa / KlikAanKlikUit Wireless Switch": [],
  "Yale HSA (Home Security Alarm), YES-Alarmkit": [["Yale", "HSA Home Security Alarm"], ["Yale", "YES-Alarmkit"]],
  "Arexx Multilogger IP-HA90, IP-TH78EXT, TSN-70E": [["Arexx", "IP-HA90"], ["Arexx", "IP-TH78EXT"], ["Arexx", "TSN-70E"]],
  "Apator Metra E-ITN 30 heat cost allocator": [["Apator", "E-ITN 30"]],
  "Apator Metra E-RM 30 water meter": [["Apator", "E-RM 30"]],
  "Clipsal CMR113 Cent-a-meter power meter": [["Clipsal", "CMR113 Cent-a-meter"]],
  "Landis & Gyr Gridstream Power Meters 9.6k": [["Landis+Gyr", "Gridstream"]],
  "Landis & Gyr Gridstream Power Meters 19.2k": [["Landis+Gyr", "Gridstream"]],
  "Landis & Gyr Gridstream Power Meters 38.4k": [["Landis+Gyr", "Gridstream"]],
  "Neptune R900 BCD flow meters": [["Neptune", "R900 BCD"]],
  "Oil Ultrasonic SMART FSK": [], "Oil Ultrasonic STANDARD FSK": [], "Oil Ultrasonic STANDARD ASK": [],
  "Elster/Honeywell R2S/REXU power meter": [["Elster", "R2S"], ["Elster", "REXU"]],
  "Elster/Honeywell R2S/REXU power meter, type-2 frames": [["Elster", "R2S"], ["Elster", "REXU"]],
  "Arad/Master Meter Dialog3G water utility meter": [["Arad", "Dialog3G"], ["Master Meter", "Dialog3G"]],
  "Emos TTX201 Temperature Sensor": [["EMOS", "TTX201"]],
  "Hyundai WS SENZOR Remote Temperature Sensor": [["Hyundai", "WS Senzor"]],
  "Philips outdoor temperature sensor (type AJ7010)": [["Philips", "AJ7010"]],
  "Philips outdoor temperature sensor (type AJ3650)": [["Philips", "AJ3650"]],
  "TFA Dostmann 30.3221.02 T/H Outdoor Sensor (also 30.3249.02)": [["TFA Dostmann", "30.3221.02"], ["TFA Dostmann", "30.3249.02"]],
  "TFA Dostmann 30.390X T/H sensors series": [["TFA Dostmann", "30.390X"]],
  "TFA-Twin-Plus-30.3049, Conrad KW9010, Ea2 BL999": [["TFA Dostmann", "Twin Plus 30.3049"], ["Conrad", "KW9010"], ["Ea2", "BL999"]],
  "TFA pool temperature sensor": [["TFA Dostmann", "Pool Temperature Sensor"]],
  "Silver Spring Networks mesh endpoint (-s 1600k)": [],
  "Sharp SPC775 weather station": [["Sharp", "SPC775"]],
  "Danfoss CFR Thermostat": [["Danfoss", "CFR Thermostat"]],
  "Celsia CZC1 Thermostat": [["Celsia", "CZC1"]],
  "Eberle Instat 868r1 floor heating thermostat remote": [["Eberle", "Instat 868-r1"]],
  "Watts WFHT-RF / WFHC-MASTERH&C-RF underfloor heating thermostat": [["Watts", "WFHT-RF"], ["Watts", "WFHC-MASTERH&C-RF"]],
  "Vaillant calorMatic VRT340f Central Heating Control": [["Vaillant", "calorMATIC VRT 340f"]],
  "SimpliSafe Gen 3 Home Security System": [["SimpliSafe", "Gen 3"]],
  "SimpliSafe Home Security System (May require disabling automatic gain for KeyPad decodes)": [["SimpliSafe", "Home Security System"]],
  "2GIG-KEY2E-345 encrypted keyfob": [["2GIG", "KEY2E-345"]],
  "Continental KR5V2X Car Remote (-f 313.8M -s 1024k)": [["Continental", "KR5V2X"]],
  "Honda Keyfob KR5V2X/1X (-f 433.6M -s 1024k)": [["Honda", "Keyfob KR5V2X"], ["Honda", "Keyfob KR5V1X"]],
  "Akhan 100F14 remote keyless entry": [["Akhan", "100F14"]],
  "Nice Flor-s remote control for gates": [["Nice", "Flor-s"]],
  "Dickert MAHS433-01 garage door remote control": [["Dickert", "MAHS433-01"]],
  "Linear Megacode Garage/Gate Remotes": [["Linear", "MegaCode"]],
  "SmartFire Proflame 2 remote control": [["SmartFire", "Proflame 2"]],
  "SRSmith Pool Light Remote Control SRS-2C-TX (-f 915M)": [["S.R. Smith", "SRS-2C-TX"]],
  "McPower Kinetic battery-less wall switch": [["McPower", "Kinetic"]],
  "Govee Water Leak Detector H5054, Door Contact Sensor B5023": [["Govee", "H5054"], ["Govee", "B5023"]],
  "Govee Water Leak Detector H5054": [["Govee", "H5054"]],
  "Govee Water Leak Detector H5059": [["Govee", "H5059"]],
  "Govee Pool/Spa Thermometer H5310": [["Govee", "H5310"]],
  "Kerui PIR / Contact Sensor": [["Kerui", "PIR Sensor"], ["Kerui", "Contact Sensor"]],
  "Kidde RF-SM-DC wireless-interconnect smoke alarm": [["Kidde", "RF-SM-DC"]],
  "Cavius smoke, heat and water detector": [["Cavius", "Smoke, Heat and Water Detector"]],
  "Cavius Door/Window sensor (-f 868.7M)": [["Cavius", "Door/Window Sensor"]],
  "DSC Security Contact": [["DSC", "Security Contact"]],
  "DSC Security Contact (WS4945)": [["DSC", "WS4945"]],
  "Chuango Security Technology": [],
  "Efergy e2 classic": [["Efergy", "e2 classic"]],
  "Efergy Optical": [["Efergy", "Optical"]],
  "Esperanza EWS": [["Esperanza", "EWS"]],
  "Omni Multisensor": [["Omni", "Multisensor"]],
  "Norgo NGE101": [["Norgo", "NGE101"]],
  "Quhwa": [["Quhwa", "Doorbell"]],
  "IKEA Sparsnas Energy Meter Monitor": [["IKEA", "Sparsnäs"]],
  "Voltcraft EnergyCount 3000 (ec3k)": [["Voltcraft", "EnergyCount 3000"]],
  "CurrentCost Current Sensor": [["Current Cost", "Current Sensor"]],
  "BlueLine Innovations Power Cost Monitor": [["BlueLine Innovations", "Power Cost Monitor"]],
  "Ford Car Key": [["Ford", "Car Key"]],
  "Honda Car Key": [["Honda", "Car Key"]],
  "Opel Mokka Car Key": [["Opel", "Mokka Car Key"]],
  "Chrysler Car Remote (-f 315.1M -s 920k)": [["Chrysler", "Car Remote"]],
  "Nidec Car Remote (-f 313.8M -s 1024k)": [["Nidec", "Car Remote"]],
  "Porsche Boxster/Cayman TPMS": [["Porsche", "Boxster/Cayman TPMS"]],
  "Sefis M3 / Careud / Sykik SRTP300 TPMS": [["Sefis", "M3"], ["Sykik", "SRTP300"]],
  "EezTire E618, Carchet TPMS, TST-507 TPMS": [["EezTire", "E618"], ["Carchet", "TPMS"], ["TST", "507"]],
  "Sainlogic SA8, Gevanti SA8 Weather Station": [["Sainlogic", "SA8"], ["Gevanti", "SA8"]],
  "LaCrosse TX31U-IT, The Weather Channel WS-1910TWC-IT": [["La Crosse Technology", "TX31U-IT"], ["The Weather Channel", "WS-1910TWC-IT"]],
  "Bresser Thermo-/Hygro-Sensor 3CH": [["Bresser", "Thermo-/Hygro-Sensor 3CH"]],
  "Bresser Thermo-/Hygro-Sensor Explore Scientific ST1005H": [["Explore Scientific", "ST1005H"]],
  "Bresser water leakage": [["Bresser", "Water Leakage Sensor"]],
  "Bresser lightning": [["Bresser", "Lightning Sensor"]],
  "Biltema rain gauge": [["Biltema", "Rain Gauge"]],
  "Burnhard BBQ thermometer": [["Burnhard", "BBQ Thermometer"]],
  "Amazon Basics Meat Thermometer": [["Amazon Basics", "Meat Thermometer"]],
  "Baldr / RainPoint rain gauge.": [["Baldr", "Rain Gauge"], ["RainPoint", "Rain Gauge"]],
  "RainPoint soil temperature and moisture sensor": [["RainPoint", "Soil Temperature and Moisture Sensor"]],
  "Springfield Temperature and Soil Moisture": [["Springfield", "Temperature and Soil Moisture Sensor"]],
  "Eurochron temperature and humidity sensor": [["Eurochron", "Temperature and Humidity Sensor"]],
  "NetAtmo temp/hum and wind sensors": [["Netatmo", "Outdoor Module"], ["Netatmo", "Wind Gauge"]],
  "Kedsum Temperature & Humidity Sensor, Pearl NC-7415": [["Kedsum", "Temperature & Humidity Sensor"], ["Pearl", "NC-7415"]],
  "Rubicson, TFA 30.3197 or InFactory PT-310 Temperature Sensor": [["Rubicson", "Temperature Sensor"], ["TFA Dostmann", "30.3197"], ["inFactory", "PT-310"]],
  "inFactory, nor-tec, FreeTec NC-3982-913 temperature humidity sensor": [["FreeTec", "NC-3982-913"]],
  "Nexus, FreeTec NC-7345, NX-3980, Solight TE82S, TFA 30.3209 temperature/humidity sensor": [["FreeTec", "NC-7345"], ["FreeTec", "NX-3980"], ["Solight", "TE82S"], ["TFA Dostmann", "30.3209"]],
  "Prologue, FreeTec NC-7104, NC-7159-675 temperature sensor": [["FreeTec", "NC-7104"], ["FreeTec", "NC-7159-675"]],
  "Solight TE44/TE66, EMOS E0107T, NX-6876-917": [["Solight", "TE44"], ["Solight", "TE66"], ["EMOS", "E0107T"], ["Pearl", "NX-6876-917"]],
  "Conrad S3318P, FreeTec NC-5849-913 temperature humidity sensor, ORIA WA50 ST389 temperature sensor": [["Conrad", "S3318P"], ["FreeTec", "NC-5849-913"], ["ORIA", "WA50"], ["ORIA", "ST389"]],
  "Ecowitt Wireless Outdoor Thermometer WH53/WH0280/WH0281A": [["Ecowitt", "WH53"], ["Ecowitt", "WH0280"], ["Ecowitt", "WH0281A"]],
  "Oregon Scientific Weather Sensor": [],
  "Fine Offset Electronics, WH25, WH32, WH32B, WN32B, WH24, WH65, WS69, HP1000, Misol WS2320 Temperature/Humidity/Pressure Sensor":
    [["Fine Offset", "WH25"], ["Fine Offset", "WH32"], ["Fine Offset", "WH32B"], ["Fine Offset", "WN32B"], ["Fine Offset", "WH24"], ["Fine Offset", "WH65"], ["Fine Offset", "WS69"], ["Fine Offset", "HP1000"], ["Misol", "WS2320"]],
  "Fine Offset Electronics, WH0530 Temperature/Rain Sensor": [["Fine Offset", "WH0530"]],
  "Fine Offset Electronics WN34S/L/D, WN38 and Froggit DP150/D35 temperature sensor": [["Fine Offset", "WN34S"], ["Fine Offset", "WN34L"], ["Fine Offset", "WN34D"], ["Fine Offset", "WN38"], ["Froggit", "DP150"], ["Froggit", "DP35"]],
  "Emax W6, rebrand Altronics x7063/4/x7064A, Optex 990040/50/51, Orium 13093/13123, Infactory FWS-1200, Newentor Q9, Otio 810025, Protmex PT3390A, Jula Marquant 014331/32, TechniSat IMETEO X6 76-4924-00, Weather Station or temperature/humidity sensor":
    [["Emax", "W6"], ["Altronics", "X7063"], ["Altronics", "X7064"], ["Altronics", "X7064A"], ["Optex", "990040"], ["Optex", "990050"], ["Optex", "990051"], ["Orium", "13093"], ["Orium", "13123"], ["inFactory", "FWS-1200"], ["Newentor", "Q9"], ["Otio", "810025"], ["Protmex", "PT3390A"], ["Jula", "Marquant 014331"], ["Jula", "Marquant 014332"], ["TechniSat", "iMeteo X6 76-4924-00"]],
  "Schou 72543 Day Rain Gauge, Motonet MTX Rain, MarQuant Rain Gauge, TFA Dostmann 30.3252.01/47.3006.01 Rain Gauge and Thermometer, ADE WS1907":
    [["Schou", "72543"], ["Motonet", "MTX Rain"], ["TFA Dostmann", "30.3252.01"], ["TFA Dostmann", "47.3006.01"], ["ADE", "WS1907"]],
  "Auriol 4-LD5661/4-LD5972/4-LD6313, Sempre 4-AH0423-4 temperature/rain sensors": [["Auriol", "4-LD5661"], ["Auriol", "4-LD5972"], ["Auriol", "4-LD6313"], ["Sempre", "4-AH0423-4"]],
  "Ambient Weather F007TH, TFA 30.3208.02, SwitchDocLabs F016TH temperature sensor": [["Ambient Weather", "F007TH"], ["TFA Dostmann", "30.3208.02"], ["SwitchDoc Labs", "F016TH"]],
  "Cotech 36-7959, SwitchDocLabs FT020T wireless weather station with USB": [["Cotech", "36-7959"], ["SwitchDoc Labs", "FT020T"]],
  "Acurite/Chaney 985 Refrigerator / Freezer Thermometer": [["AcuRite", "985"], ["Chaney", "985"]],
  "Acurite 606TX / Technoline TX960 Temperature Sensor": [["AcuRite", "606TX"], ["Technoline", "TX960"]],
  "Acurite Grill/Meat Thermometer 01185M": [["AcuRite", "01185M"]],
  "Acurite 590TX Temperature with optional Humidity": [["AcuRite", "590TX"]],
  "Inkbird ITH-20R temperature humidity sensor": [["Inkbird", "ITH-20R"]],
  "Globaltronics QUIGG GT-TMBBQ-05": [["QUIGG", "GT-TMBBQ-05"]],
  "Typhur Sync Gold meat thermometer probe": [["Typhur", "Sync Gold"]],
  "Vevor Wireless Weather Station 7-in-1": [["Vevor", "7-in-1 Weather Station"]],
  "Missil ML0757 weather station": [["Missil", "ML0757"]],
  "Thermopro TP11 Thermometer": [["ThermoPro", "TP11"]],
  "Fine Offset WH1050 Weather Station": [["Fine Offset", "WH1050"]],
  "TFA 30.3151 Weather Station": [["TFA Dostmann", "30.3151"]],
  "Martec MPLCD Ceiling Fan Remote": [["Martec", "MPLCD"]],
  "Regency Ceiling Fan Remote (-f 303.75M to 303.96M)": [["Regency", "Ceiling Fan Remote"]],
  "DirecTV RC66RX Remote Control": [["DirecTV", "RC66RX"]],
  "Dish remote 6.3": [["Dish Network", "Remote 6.3"]],
  "Silvercrest Remote Control": [["Silvercrest", "Remote Control"]],
  "Waveman Switch Transmitter": [["Waveman", "Switch Transmitter"]],
  "KlikAanKlikUit Wireless Switch": [["KlikAanKlikUit", "Wireless Switch"]],
  "Elro DB286A Doorbell": [["Elro", "DB286A"]],
  "GE Color Effects": [["GE", "Color Effects"]],
  "Somfy RTS": [], "Somfy io-homecontrol": [], "DeltaDore X3D devices": [], "Nexa": [], "LightwaveRF": [],
  "Intertechno 433": [], "Mebus 433": [], "Insteon": [], "Quinetic": [], "RF-tech": [], "Radiohead ASK": [],
  "X10 RF": [], "X10 Security": [], "Visonic powercode": [], "FS20 / FHT": [], "IBIS beacon": [],
  "RfxMeter, RFXPwr": [["RFXCOM", "RFXmeter"], ["RFXCOM", "RFXpwr"]],
  "FSL Cricket Scoreboard Controller": [["FSL", "Cricket Scoreboard Controller"]],
  "Sensible Living Mini-Plant Moisture Sensor": [["Sensible Living", "Mini-Plant Moisture Sensor"]],
  "GEO minim+ energy monitor": [["GEO", "minim+"]],
  "Revolt NC-5642 Energy Meter": [["Revolt", "NC-5642"]],
  "Gear Hive TPMS sensor": [["Gear Hive", "TPMS"]],
  "Schrader Motorcycle TPMS sensor": [["Schrader", "Motorcycle TPMS"]],
  "GM-Aftermarket TPMS": [["GM", "Aftermarket TPMS"]],
  "Flowis flow meters": [["Flowis", "Flow Meter"]],
  "Neptune R900 flow meters": [["Neptune", "R900"]],
  "Mueller Hot Rod water meter": [["Mueller", "Hot Rod"]],
  "Template decoder": [], "General purpose decoder": [],
};

// Protocol families and generic encoders: no device model to record.
const SKIP = /^(ERT |Wireless M-Bus|Standard Consumption|RADIAN|Microchip HCS|Security\+|Generic |ANT and|EnOcean|Template|General purpose)/i;

/** Split a decoder name into vendor + model pairs ([] when it names no device model). */
export function splitDeviceName(raw: string): Pair[] {
  const name = clean(raw);
  if (name in OVERRIDES) return OVERRIDES[name].map(([vendor, model]) => ({ vendor, model }));
  if (SKIP.test(name)) return [];
  const text = name
    .replace(/\((?:[^()]*?(?:-[fs] |bit\/s|kbps|sync|fsk|ook|pwm|may require|older)[^()]*)\)/gi, " ")
    .replace(/\(([^()]*)\)/g, (_, inner: string) => (brandAt(inner.split(" "), 0) ? `, ${inner},` : " "))
    .replace(/[.]$/, "");
  const segments = text.split(/\s*,\s*|\s+\/\s+|\s+(?:rebrand|aka|and|or)\s+(?=[A-Z0-9])/).map(clean).filter(Boolean);
  const pairs: Pair[] = [];
  let vendor = "";
  segments.forEach((seg, si) => {
    const words = seg.split(" ");
    let i = 0;
    const b = brandAt(words, 0);
    if (b) { vendor = b.brand; i = b.len; }
    else if (si === 0 && words.length > 1 && !isDescriptor(words[0]) && (!isModelToken(words[0]) || !/\d/.test(words[0]) && isModelToken(words[1]))) {
      vendor = canonical(words[0].replace(/\/.*$/, "")); i = 1; // "Acurite …", "ESIC EMT7110 …"
    }
    else if (si > 0 && words.length > 1 && isCapWord(words[0]) && isModelToken(words[1])) { vendor = canonical(words[0]); i = 1; }
    if (!vendor) return;
    // model = capitalised words directly before the first model token, then model tokens
    const rest = words.slice(i);
    const first = rest.findIndex(isModelToken);
    if (first < 0) return;
    let start = first;
    while (start > 0 && isCapWord(rest[start - 1])) start--;
    let end = first + 1;
    while (end < rest.length && (isModelToken(rest[end]) || /^\d{1,2}$/.test(rest[end]) && end + 1 < rest.length && isModelToken(rest[end + 1]))) end++;
    const run = rest.slice(start, end);
    // "WS3500 WS4500": several complete model numbers side by side are separate models
    const complete = (w: string) => /\d/.test(w) && /[a-z]/i.test(w) && w.length >= 4;
    const models = run.length > 1 && run.every(complete) ? run : [run.join(" ")];
    for (const m of models) for (const x of m.includes(" ") ? [m] : expandSlashes(m)) pairs.push({ vendor, model: x });
  });
  // "Ford TPMS", "Watts Vision thermostat": a brand and what it is, no model number
  if (!pairs.length && segments.length === 1) {
    const words = segments[0].split(" ");
    const b = brandAt(words, 0);
    const n = b ? b.len : 1;
    const rest = words.slice(n).filter((w) => !/^(devices?)$/i.test(w));
    if (rest.length && (b || isCapWord(words[0]))) pairs.push({ vendor: b?.brand ?? canonical(words[0]), model: rest.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") });
  }
  return pairs;
}

// ---------- category and status ----------

// Ordered: first match on the decoder name wins.
export const RTL_CATEGORIES: [RegExp, string][] = [
  [/tpms|\b(tyre|tire)\b/i, "vehicle"],
  [/\b(car (remote|key)|keyless entry|keyfob kr5v|mokka)/i, "vehicle"],
  [/\bcolor effects\b/i, "light"],
  [/\bsmart socket\b/i, "smart-plug"],
  [/\b(door ?bell|chime)\b/i, "other"],
  [/\b(thermostat|heating control)\b/i, "appliance"],
  [/\b(sensors?|thermometers?|hygrometer|meters?|gauge|monitor|station|wetterstation|detector|anemometer|probe|smoke alarm|multisensor|logger|radiologger|allocator|lightning|leak|contact)\b|thermo|hygro/i, "sensor"],
  [/\b(wall switch|switch transmitter|wireless switch|light switch)\b/i, "switch"],
  [/\b(remote|keyfob|key fob|controller|control|timer|socket|shutter|blinds?|curtain|tag)s?\b/i, "other"],
];

// Output fields that only a measuring device reports (the decoder's data_make keys).
const MEASURES = /"(temperature_[CF]|temperature_\d_C|humidity|rain_(mm|in)|wind_(avg|max|dir)\w*|pressure_\w+|moisture|power\w*|energy\w*|current\w*|impulses|ct1|consumption\w*|light_lux|uv|uvi|pm2_5_ug_m3|co2_ppm|depth_cm|leak|water_leak|smoke|strike_count|storm_dist\w*)"/;

/** Category from the model, then the decoder name, else "sensor" when the decoder outputs measurements. */
export function rtlCategory(name: string, source = "", model = ""): string {
  const byName = firstMatch(RTL_CATEGORIES, model, "") || firstMatch(RTL_CATEGORIES, name, "");
  if (byName) return byName;
  return MEASURES.test(source) ? "sensor" : "other";
}

const PARTIAL = /\b(car (remote|key)|keyless entry|keyfob|key fob|encrypted|rolling|keeloq|thermostat|heating control|security system|home security|bidirectional|2 way)\b/i;
const PARTIAL_NOTE = /undecoded|unknown|unconfirmed|not attempt|needs field verification|conversion unknown/i;

export function rtlStatus(d: Decoder, category: string): "controllable" | "partial-protocol" {
  if (PARTIAL.test(d.name) || category === "appliance" || PARTIAL_NOTE.test(d.note)) return "partial-protocol";
  return "controllable";
}

// ---------- records ----------

/**
 * Install route (SPEC R1): rtl_433 runs on a computer with a cheap SDR receiver and decodes
 * what the device transmits; nothing changes on the device.
 */
export const RTL_433_INSTALL: InstallRoute = {
  project: "rtl_433",
  method: "host-software",
  guide: `https://github.com/${REPO}`,
  difficulty: "medium",
  tools: ["RTL-SDR USB receiver (or another SDR rtl_433 supports)"],
  brick_risk: "none",
  reversible: "yes",
  notes: "Receive only: rtl_433 decodes the radio messages the device sends; it does not change or command the device.",
};

export function fromDecoderFile(path: string, text: string, date = today()): DeviceRecord[] {
  if (!DECODER_FILE.test(path)) return [];
  const file = path.split("/").pop()!;
  const url = `https://github.com/${REPO}/blob/${BRANCH}/${path}`;
  const out: DeviceRecord[] = [];
  for (const d of extractDecoders(text)) {
    if (d.disabled >= 2) continue; // disabled / hidden templates
    for (const p of splitDeviceName(d.name)) {
      const category = rtlCategory(d.name, text, p.model);
      const status = rtlStatus(d, category);
      out.push({
        id: makeId(p.vendor, p.model),
        vendor: p.vendor,
        model: p.model,
        category,
        identifiers: { sku: [p.model] },
        status,
        summary: `Radio protocol decoded by rtl_433 as "${d.name}".`,
        interfaces: [{ name: "433/868/915 MHz radio", transport: "rf", status: status === "controllable" ? "documented" : "partial", spec: url }],
        projects: [{ name: `rtl_433 decoder ${file}`, url, kind: "driver", license: LICENSE, freedom: deviceFirmwareFreedom() }],
        install: [{ ...RTL_433_INSTALL, tools: [...RTL_433_INSTALL.tools!] }],
        provenance: { sources: ["rtl_433"] },
        updated: date,
      } as DeviceRecord);
    }
  }
  return out;
}

const source: Source = {
  source: "rtl_433",
  name: "rtl_433",
  url: "https://github.com/merbanan/rtl_433",
  license: LICENSE,
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => DECODER_FILE.test(p));
    const out = await mapLimit(files, 8, async (p) => fromDecoderFile(p, await githubRaw(REPO, BRANCH, p)));
    console.error(`rtl_433: ${files.length} decoder files`);
    return out.flat();
  },
};
export default source;
