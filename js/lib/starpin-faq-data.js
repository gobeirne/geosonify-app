/*
  starpin-faq-data.js  -  js/lib/starpin-faq-data.js

  Starpin FAQ - translatable data file, same shape as faq-data.js.
  To translate: copy this file, change STARPIN_FAQ.lang, replace the 'q' and 'a'
  strings, keep the structure identical, and load your translated file instead.

  Tone: clear, conversational, and lightly curious. Let the idea supply the
  interest rather than overselling it. Explain how to play, then describe
  privacy in plain language.
  The privacy answers are held to a "literally true" standard - they must stay
  accurate for the current provisional trial. Deep technical detail belongs in a
  separate "under the hood" page, not here. If the code changes in a way that
  makes a privacy answer untrue, fix the answer in the same commit.
*/
(function (global) {
  'use strict';

  var STARPIN_FAQ = {
    lang: 'en',
    title: 'What on Earth is a Starpin?',
    sections: [

      {
        id: 'the-strange-idea',
        title: 'How Starpin works',
        items: [
          {
            id: 'what-is-starpin',
            q: 'What is Starpin?',
            a: `<p>Starpin maps stars to places on Earth.</p>
<p>Every star can be matched to a point on the ground. As the Earth turns, there is a moment each day when the star is directly overhead at that point. Starpin puts these places on a map so you can visit and collect them.</p>
<p>A starpin might fall in a park, beside a road, on a beach, on a farm, or somewhere much harder to reach. Some will be wonderfully inconvenient. When you reach one, you can bag it and add it to your Starpin log.</p>`
          },
          {
            id: 'how-map-works',
            q: 'How does the map work?',
            a: `<p>Starpin uses a system called HEALPix to divide the whole Earth into a grid.</p>
<p>Lines of longitude converge towards the poles, so an ordinary latitude-longitude grid does not divide the Earth evenly. HEALPix covers it with equal-area, diamond-shaped pieces instead. Each piece has the same area, wherever it lies on the globe.</p>
<p>This grid is what Starpin uses to match stars to places on the ground.</p>`
          },
          {
            id: 'what-is-cornerstone',
            q: 'What is a cornerstone?',
            a: `<p>A cornerstone is a point where the corners of the HEALPix grid pieces meet.</p>
<p>Starpins come from stars; cornerstones come from the geometry of the grid itself. You can collect both. A cornerstone may look like an ordinary patch of pavement or field, but it marks an exact meeting point in the grid.</p>`
          },
          {
            id: 'what-are-tiers',
            q: 'What are tiers?',
            a: `<p>Tiers are different levels of detail in the grid.</p>
<p>At a low tier, the Earth is divided into a small number of very large pieces. At each higher tier, every piece divides again. The grid becomes finer and its cornerstones become more closely spaced. Low-tier cornerstones are part of a sparse, planet-wide pattern; higher-tier ones are more numerous and usually easier to reach.</p>`
          }
        ]
      },


      {
        id: 'the-view',
        title: 'The map and the sky',
        items: [
          {
            id: 'what-am-i-seeing',
            q: 'What am I looking at?',
            a: `<p>A map of the ground, with the sky laid underneath it.</p>
<p>Switch between <strong>Ground</strong> and <strong>Sky</strong> to choose what lies under the streets: aerial imagery, or a photograph of the stars whose starpins are on this patch of ground. Both are drawn at the same scale: one arcsecond of sky is about 31 metres of ground, wherever you are.</p>
<p>At street level you are looking at a very small piece of sky. A human hair held at arm's length covers about 20 arcseconds, or roughly 600 metres of ground.</p>`
          },
          {
            id: 'mirrored',
            q: 'Why is the sky mirrored?',
            a: `<p>Because it is lying on the ground. Looking up, east is on your left; on a map, east is on the right. To make every star sit exactly on its starpin, the sky is flipped east to west, the way a picture on a glass ceiling would look from above.</p>
<p>This means constellations appear reversed compared with the real sky. Tap the <strong>Look up</strong> button to turn the view over and see the sky the right way round, as it would appear overhead.</p>`
          },
          {
            id: 'the-circles',
            q: 'What are the circles and glows?',
            a: `<p><strong>Yellow rings</strong> are starpins. Each ring is the catch circle: 3 arcseconds of sky, or about 93 metres of ground. Get within it and the visit counts. Tap a star to see whether a mapped street or path passes through its circle. That comes from OpenStreetMap, so treat it as a hint rather than a promise.</p>
<p><strong>Amber glows</strong> are cornerstones. The rarer the cornerstone, the larger and brighter its glow, because rarer ones are spread further apart.</p>
<p>Anything you have already bagged turns <strong>green</strong>, and the <strong>blue dot</strong> is you.</p>`
          },
          {
            id: 'blurry-sky',
            q: 'Why do the stars look blurry close up?',
            a: `<p>The sky photographs come from sky surveys, whose detail runs out long before a map's does. Each pixel of the survey covers about 25 metres of ground, so at street level the stars go soft.</p>
<p>A bright star also looks bigger than a faint one. That is the telescope, not the star: its light spreads further across the photograph. The star itself is far too small to see as a disc.</p>`
          },
          {
            id: 'four-words',
            q: 'What are the four words?',
            a: `<p>They are another way of writing where you are. Starpin turns a place into four words from the BIP39 wordlist, an open list originally designed for cryptocurrency wallets.</p>
<p>It is not what3words. The list is free to use, anyone can decode the words, and they come in ten languages. Starpin uses your device's language where it can.</p>
<p>You can paste almost anything into the address box: four words in any of those languages, ordinary coordinates, a Google or Apple Maps link, or a Geosonify code. Starpin works out what it is and takes you there.</p>`
          },
          {
            id: 'compass',
            q: 'Why does it ask about motion and orientation?',
            a: `<p>So Starpin can point you towards a target from the way you are facing. The compass is on by default.</p>
<p>On an iPhone, the permission can only be requested after you tap something, so Starpin asks the first time you tap. Depending on your version of iOS, it may ask again on later visits. You can turn the compass off with the <strong>Compass</strong> button in <strong>Go</strong>, and it will stay off.</p>`
          },
          {
            id: 'cards',
            q: 'What\u2019s on a find\u2019s card?',
            a: `<p>A starpin card shows the star's own patch of sky laid on the ground beneath it, with the streets, the catch circle, and the direction you approached from. The glow behind it shows how bright the star is.</p>
<p>A cornerstone card shows the grid lines over the surrounding streets, glowing more strongly the rarer the cornerstone is.</p>
<p>Both cards name the place in the style used locally, such as a suburb, city and country. If a find is at sea, the card names the nearest sea and settlement instead.</p>`
          }
        ]
      },
      {
        id: 'going-out',
        title: 'Finding and logging Starpins',
        items: [
          {
            id: 'how-log',
            q: 'How do I log a visit?',
            a: `<p>Tap <strong>Use my location</strong> so Starpin can determine where you are, then bag the target.</p>
<p>If you are close enough (within about 93 metres of a starpin or cornerstone), Starpin records a visit. If not, you can save your closest approach instead. The record is made from the location fix on your device, so you do not need an internet connection at the moment you arrive.</p>`
          },
          {
            id: 'culmination',
            q: 'What\u2019s a culmination?',
            a: `<p>A star's culmination is the moment when it is directly overhead at its corresponding place on Earth.</p>
<p>If you reach the place at that time, you complete the alignment between yourself, the point on the ground, and the star above you. Starpin marks this separately from an ordinary visit.</p>`
          },
          {
            id: 'drive-by',
            q: 'What is drive-by mode?',
            a: `<p>Drive-by mode can record a visit when you pass close enough to a target while travelling by car, bus, or bike.</p>
<p>The find still counts, but it is marked as a drive-by so your log records how it happened.</p>`
          }
        ]
      },

      {
        id: 'sharing',
        title: 'Groups and sharing',
        items: [
          {
            id: 'what-are-groups',
            q: 'What are groups?',
            a: `<p>Groups let family or friends share selected finds with one another.</p>
<p>When a group member looks at a starpin or cornerstone, they can see who else in the group has visited it. Your private log remains separate. Only the finds you choose to share are copied to the group.</p>`
          },
          {
            id: 'make-group',
            q: 'How do I make a group?',
            a: `<p>Open <strong>Groups</strong>, give the group a name, and tap <strong>Create group &amp; get link</strong>.</p>
<p>Starpin creates an invitation that you can send to the people you want to join. You can also choose the name you will use within that group. This is the name other members will see beside your shared finds.</p>`
          },
          {
            id: 'join-group',
            q: 'How do I join one?',
            a: `<p>Open the invitation link. If the person who created the group sent its secret code separately, Starpin will ask you to enter that as well.</p>
<p>Once you have joined, the group appears in your Groups tab.</p>`
          },
          {
            id: 'share-find',
            q: 'How do I share a find?',
            a: `<p>After you bag something, Starpin gives you the option to share it. You can also share an earlier find from your Log or from the target itself.</p>
<p>A target may have several related records, such as a closest approach, a later visit, and a culmination. Starpin shows these together so you can choose which records to share. Nothing is shared until you tap <strong>Share</strong>.</p>`
          },
          {
            id: 'old-finds',
            q: 'Can I share something I found ages ago?',
            a: `<p>Yes. Your own log is the master copy, and you can share any find stored in it.</p>`
          },
          {
            id: 'who-in-charge',
            q: 'Who\u2019s in charge of a group?',
            a: `<p>For now, nobody. This version has no accounts, administrators, approval queues, or moderators. Anyone with the group's invitation and secret can take part.</p>
<p>Only give the invitation and secret to people you trust. A separate version with more management controls is planned for clubs, classes, and organisations.</p>`
          },
          {
            id: 'leave-group',
            q: 'Can I leave a group?',
            a: `<p>Yes. Tap <strong>Leave group</strong> to remove the group from your device. This does not affect your own Starpin log.</p>
<p>Anything you previously shared may remain in the group and on other members' devices.</p>`
          },
          {
            id: 'duplicate-names',
            q: 'Why do two groups have the same name?',
            a: `<p>Group names do not have to be unique. If you belong to two groups called "Family", Starpin shows an identifier beside each one so you can tell them apart. The identifier is only a label; it is not the group's secret.</p>`
          }
        ]
      },

      {
        id: 'your-data',
        title: 'Your data',
        items: [
          {
            id: 'where-kept',
            q: 'Where are my finds kept?',
            a: `<p>Your Starpin log is stored on your device. It is your record of the places you have visited.</p>
<p>Group sharing does not replace or modify that log. When you share something, Starpin sends an encrypted copy to the group. Records received from a group are stored separately and cannot overwrite your own finds.</p>`
          },
          {
            id: 'encrypted',
            q: 'Is group sharing encrypted?',
            a: `<p>Yes. Shared finds are encrypted on your device before they are sent. The group's invitation information and secret code are needed to derive the keys that can read them. The storage service receives the encrypted data, not the readable visit.</p>`
          },
          {
            id: 'can-starpin-read',
            q: 'Can Starpin read my private group finds?',
            a: `<p>The storage service does not receive your visit as readable text, coordinates, or a place name. It stores encrypted data and does not hold the key needed to read it.</p>
<p>It can still see some technical information about connections, including whether data was read or written and approximately when. Starpin encrypts the content of private group records; it does not conceal every trace of network activity.</p>`
          },
          {
            id: 'other-groups',
            q: 'Can another group see ours?',
            a: `<p>No. Membership of one private group does not provide access to any other group. There is no public directory of Starpin groups, their members, or their finds. You can see only the groups you belong to and the records shared with them.</p>`
          },
          {
            id: 'invite-leaks',
            q: 'What if someone gets our group invite?',
            a: `<p>Anyone who has both the invitation information and the secret can read the group's shared finds and add new ones. If these details reach someone you do not trust, the current trial version cannot remove that person's access. Create a new group and invite the remaining members instead.</p>`
          },
          {
            id: 'can-others-delete',
            q: 'Can another member delete my finds?',
            a: `<p>No other member can delete anything from your own log. Ordinary group members also cannot edit or remove shared records once they have been stored.</p>
<p>Your personal log is still data stored on a device and may be lost if the device is lost, damaged, or cleared. Keep a backup if you want to preserve your Starpin history.</p>`
          },
          {
            id: 'presence',
            q: 'Does sharing prove somebody really went there?',
            a: `<p>Not yet. A Starpin record includes the location fix reported by that person's device, but this version does not provide cryptographic proof that the person was at the target. Members of a private group must therefore trust one another.</p>`
          },
          {
            id: 'what-is-sent',
            q: 'What does Starpin send over the internet?',
            a: `<p>Your log stays on your device. To draw the map and the sky, Starpin asks these services for pictures and names of the area you are looking at:</p>
<ul>
<li><strong>OpenFreeMap</strong> for the streets, coasts, and borders, and <strong>OpenStreetMap</strong> or <strong>Esri</strong> for ground imagery.</li>
<li><strong>CDS Strasbourg</strong> for the sky photographs and the star catalogue.</li>
<li><strong>OpenStreetMap's Nominatim</strong> for the place name on a find's card. Starpin asks once, the first time you open that card, and keeps the answer on your device.</li>
</ul>
<p>None of these receives your log. Each receives the area it is asked about. When the map is centred on you, that area is roughly where you are. Like any website, they also see your internet address.</p>
<p>The app's code and fonts are also downloaded from public code libraries and Google Fonts. Group sharing uses a separate storage service, described above.</p>`
          },
          {
            id: 'finished',
            q: 'Is this finished?',
            a: `<p>No. Starpin is still a trial, and its sharing system is being tested separately from the main app. Your own Starpin log remains the primary record of your finds. Group sharing and its supporting features may change as they are tested and developed.</p>`
          }
        ]
      }

    ]
  };

  global.STARPIN_FAQ = STARPIN_FAQ;
  if (typeof module !== 'undefined' && module.exports) module.exports = STARPIN_FAQ;

})(typeof self !== 'undefined' ? self : this);
