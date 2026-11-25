/**
 * Pays (code ISO, nom, indicatif) + validation des numéros de téléphone — partagé navigateur + serveur.
 * Le Sénégal est toujours en premier ; les autres sont triés par ordre alphabétique.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Countries = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RAW =
    'AF|Afghanistan|93;ZA|Afrique du Sud|27;AL|Albanie|355;DZ|Algérie|213;DE|Allemagne|49;AD|Andorre|376;AO|Angola|244;' +
    'AG|Antigua-et-Barbuda|1268;SA|Arabie saoudite|966;AR|Argentine|54;AM|Arménie|374;AU|Australie|61;AT|Autriche|43;' +
    'AZ|Azerbaïdjan|994;BS|Bahamas|1242;BH|Bahreïn|973;BD|Bangladesh|880;BB|Barbade|1246;BE|Belgique|32;BZ|Belize|501;' +
    'BJ|Bénin|229;BT|Bhoutan|975;BY|Biélorussie|375;MM|Birmanie|95;BO|Bolivie|591;BA|Bosnie-Herzégovine|387;BW|Botswana|267;' +
    'BR|Brésil|55;BN|Brunei|673;BG|Bulgarie|359;BF|Burkina Faso|226;BI|Burundi|257;KH|Cambodge|855;CM|Cameroun|237;' +
    'CA|Canada|1;CV|Cap-Vert|238;CF|Centrafrique|236;CL|Chili|56;CN|Chine|86;CY|Chypre|357;CO|Colombie|57;KM|Comores|269;' +
    'CG|Congo-Brazzaville|242;CD|Congo-Kinshasa (RDC)|243;KP|Corée du Nord|850;KR|Corée du Sud|82;CR|Costa Rica|506;' +
    "CI|Côte d'Ivoire|225;HR|Croatie|385;CU|Cuba|53;DK|Danemark|45;DJ|Djibouti|253;DM|Dominique|1767;EG|Égypte|20;" +
    'AE|Émirats arabes unis|971;EC|Équateur|593;ER|Érythrée|291;ES|Espagne|34;EE|Estonie|372;SZ|Eswatini|268;' +
    'US|États-Unis|1;ET|Éthiopie|251;FJ|Fidji|679;FI|Finlande|358;FR|France|33;GA|Gabon|241;GM|Gambie|220;GE|Géorgie|995;' +
    'GH|Ghana|233;GR|Grèce|30;GD|Grenade|1473;GP|Guadeloupe|590;GT|Guatemala|502;GN|Guinée|224;GQ|Guinée équatoriale|240;' +
    'GW|Guinée-Bissau|245;GY|Guyana|592;GF|Guyane|594;HT|Haïti|509;HN|Honduras|504;HK|Hong Kong|852;HU|Hongrie|36;' +
    'IN|Inde|91;ID|Indonésie|62;IQ|Irak|964;IR|Iran|98;IE|Irlande|353;IS|Islande|354;IL|Israël|972;IT|Italie|39;' +
    'JM|Jamaïque|1876;JP|Japon|81;JO|Jordanie|962;KZ|Kazakhstan|7;KE|Kenya|254;KG|Kirghizistan|996;KI|Kiribati|686;' +
    'XK|Kosovo|383;KW|Koweït|965;RE|La Réunion|262;LA|Laos|856;LS|Lesotho|266;LV|Lettonie|371;LB|Liban|961;LR|Liberia|231;' +
    'LY|Libye|218;LI|Liechtenstein|423;LT|Lituanie|370;LU|Luxembourg|352;MK|Macédoine du Nord|389;MG|Madagascar|261;' +
    'MY|Malaisie|60;MW|Malawi|265;MV|Maldives|960;ML|Mali|223;MT|Malte|356;MA|Maroc|212;MH|Marshall (Îles)|692;' +
    'MQ|Martinique|596;MU|Maurice|230;MR|Mauritanie|222;MX|Mexique|52;FM|Micronésie|691;MD|Moldavie|373;MC|Monaco|377;' +
    'MN|Mongolie|976;ME|Monténégro|382;MZ|Mozambique|258;NA|Namibie|264;NR|Nauru|674;NP|Népal|977;NI|Nicaragua|505;' +
    'NE|Niger|227;NG|Nigeria|234;NO|Norvège|47;NZ|Nouvelle-Zélande|64;OM|Oman|968;UG|Ouganda|256;UZ|Ouzbékistan|998;' +
    'PK|Pakistan|92;PW|Palaos|680;PS|Palestine|970;PA|Panama|507;PG|Papouasie-Nouvelle-Guinée|675;PY|Paraguay|595;' +
    'NL|Pays-Bas|31;PE|Pérou|51;PH|Philippines|63;PL|Pologne|48;PT|Portugal|351;QA|Qatar|974;DO|République dominicaine|1809;' +
    'RO|Roumanie|40;GB|Royaume-Uni|44;RU|Russie|7;RW|Rwanda|250;KN|Saint-Kitts-et-Nevis|1869;SM|Saint-Marin|378;' +
    'VC|Saint-Vincent-et-les-Grenadines|1784;LC|Sainte-Lucie|1758;SB|Salomon (Îles)|677;SV|Salvador|503;WS|Samoa|685;' +
    'ST|Sao Tomé-et-Principe|239;SN|Sénégal|221;RS|Serbie|381;SC|Seychelles|248;SL|Sierra Leone|232;SG|Singapour|65;' +
    'SK|Slovaquie|421;SI|Slovénie|386;SO|Somalie|252;SD|Soudan|249;SS|Soudan du Sud|211;LK|Sri Lanka|94;SE|Suède|46;' +
    'CH|Suisse|41;SR|Suriname|597;SY|Syrie|963;TJ|Tadjikistan|992;TW|Taïwan|886;TZ|Tanzanie|255;TD|Tchad|235;' +
    'CZ|Tchéquie|420;TH|Thaïlande|66;TL|Timor oriental|670;TG|Togo|228;TO|Tonga|676;TT|Trinité-et-Tobago|1868;' +
    'TN|Tunisie|216;TM|Turkménistan|993;TR|Turquie|90;TV|Tuvalu|688;UA|Ukraine|380;UY|Uruguay|598;VU|Vanuatu|678;' +
    'VA|Vatican|39;VE|Venezuela|58;VN|Viêt Nam|84;YE|Yémen|967;ZM|Zambie|260;ZW|Zimbabwe|263';

  const LIST = RAW.split(';').map((s) => {
    const [code, name, dial] = s.split('|');
    return { code, name, dial };
  });
  LIST.sort((a, b) => (a.code === 'SN' ? -1 : b.code === 'SN' ? 1 : a.name.localeCompare(b.name, 'fr')));
  const BY_CODE = Object.fromEntries(LIST.map((c) => [c.code, c]));
  const KEEP_ZERO = ['CI', 'IT', 'VA', 'SM']; // numéros à 10 chiffres commençant par 0 (Côte d'Ivoire), Italie…

  const flag = (code) =>
    /^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🏳️';

  /**
   * Numéro national -> format international (+221771234567), ou message d'erreur.
   * @returns {{ok:true, e164:string} | {ok:false, error:string}}
   */
  function normalizePhone(countryCode, raw) {
    const c = BY_CODE[countryCode];
    if (!c) return { ok: false, error: 'Choisissez votre pays.' };
    let digits = String(raw || '').replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) {
      digits = digits.slice(1);
      if (digits.startsWith(c.dial)) digits = digits.slice(c.dial.length);
    } else if (digits.startsWith('00' + c.dial)) digits = digits.slice(2 + c.dial.length);
    if (c.code === 'SN') {
      if (!/^[37]\d{8}$/.test(digits)) return { ok: false, error: 'Numéro sénégalais invalide (9 chiffres, ex. 77 123 45 67).' };
    } else {
      // le 0 initial est un préfixe national à retirer (ex. 06 en France), sauf là où il fait partie du numéro
      if (!KEEP_ZERO.includes(c.code)) digits = digits.replace(/^0+/, '');
      if (digits.length < 5 || digits.length > 14) return { ok: false, error: 'Numéro de téléphone invalide.' };
    }
    return { ok: true, e164: '+' + c.dial + digits };
  }

  return { LIST, BY_CODE, flag, normalizePhone };
});
