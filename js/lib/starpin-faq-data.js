/*
  starpin-faq-data.js  -  js/lib/starpin-faq-data.js

  Starpin FAQ - translatable data file, same shape as faq-data.js.
  To translate: copy this file, change STARPIN_FAQ.lang, replace the 'q' and 'a'
  strings, keep the structure identical, and load your translated file instead.

  Tone: lead with the wonder, then how to play, then plain-language privacy.
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
        title: 'The strange idea',
        items: [
          {
            id: 'what-is-starpin',
            q: 'What is Starpin?',
            a: `<p>Starpin is a way of turning the sky into places you can actually visit.</p>
<p>Every star can be matched to a point on Earth. As the planet turns, there's a moment each day when that star stands directly overhead at its place. Starpin puts those places on the map, so you can go and find them.</p>
<p>Some are in parks. Some are beside roads. Some are on mountaintops, farms, beaches, or in the middle of nowhere. Some will be wonderfully inconvenient. When you reach one, you can bag it and add it to your own Starpin log.</p>`
          },
          {
            id: 'how-map-works',
            q: 'How does the map work?',
            a: `<p>Underneath Starpin is a way of dividing up the whole Earth called HEALPix.</p>
<p>Latitude and longitude drape a grid of lines over the planet, but those lines bunch up and get squashed near the poles. HEALPix does something cleverer: it covers the Earth in equal-area, diamond-shaped pieces that stay the same size wherever they are on the globe.</p>
<p>Starpin uses that hidden grid to give the stars their places on the ground.</p>`
          },
          {
            id: 'what-is-cornerstone',
            q: 'What is a cornerstone?',
            a: `<p>A cornerstone is one of the special points where the corners of those diamond pieces meet - the bones of the grid.</p>
<p>Starpins come from stars. Cornerstones come straight from the geometry of the Earth-grid itself, so you can collect them too. There's something pleasing about standing on a perfectly ordinary patch of pavement and knowing that, mathematically, several pieces of the planet meet under your feet.</p>`
          },
          {
            id: 'what-are-tiers',
            q: 'What are tiers?',
            a: `<p>The grid comes in different levels of detail, which Starpin calls tiers.</p>
<p>At a low tier the Earth is split into a small number of enormous pieces. Climb through the tiers and each piece divides again, so the grid gets finer and the cornerstones grow closer together. It's a bit like zooming into a map - except the grid itself gets richer the further in you go. A low-tier cornerstone belongs to a sparse, planet-wide pattern; higher-tier ones are more common and more closely spaced.</p>`
          }
        ]
      },

      {
        id: 'going-out',
        title: 'Going out and finding one',
        items: [
          {
            id: 'how-log',
            q: 'How do I log a visit?',
            a: `<p>Tap <strong>Use my location</strong> so Starpin knows where you are, then bag the target.</p>
<p>If you're close enough, it counts as a visit. If you don't quite make it, Starpin can save a closest approach instead - so your log tells the real story, not just the perfect finds but the nearly-there ones too. Your visit is built from the location fix on your own device, so you don't need a signal at the exact moment you arrive.</p>`
          },
          {
            id: 'culmination',
            q: 'What\u2019s a culmination?',
            a: `<p>This is where things get properly Starpin.</p>
<p>A star's culmination is the moment it's exactly overhead at its place on Earth. Getting to the right spot is one thing. Getting to the right spot at the right moment is another. Manage both and you've got the full alignment - you, the point on the ground, and the star directly above you - and Starpin marks it specially.</p>`
          },
          {
            id: 'drive-by',
            q: 'What is drive-by mode?',
            a: `<p>Sometimes the universe has thoughtfully placed a starpin right beside the road.</p>
<p>Drive-by mode is for those. If you pass through a target while travelling - car, bus, bike - Starpin can catch the visit without pretending you stopped for a ceremonial expedition. It's still a real find; it just gets marked as a drive-by so you remember how it happened.</p>`
          }
        ]
      },

      {
        id: 'sharing',
        title: 'Sharing with your people',
        items: [
          {
            id: 'what-are-groups',
            q: 'What are groups?',
            a: `<p>Groups let you turn Starpin into a shared little world with family or friends.</p>
<p>Make a group, invite your people, and you can share chosen finds with each other. When someone in the group looks at a starpin or cornerstone, they can see who else in the group has been there. Your private log stays yours - sharing just adds a copy of the finds you pick to the group.</p>`
          },
          {
            id: 'make-group',
            q: 'How do I make a group?',
            a: `<p>Open <strong>Groups</strong>, give the group a name, and tap <strong>Create group &amp; get link</strong>.</p>
<p>Starpin gives you an invite to send to the people you want to join. You can also give yourself a name for that group - "Dad", "Nana", "LucyGoose", "Supreme Commander", whatever seems right. That's how you'll show up when you share a find.</p>`
          },
          {
            id: 'join-group',
            q: 'How do I join one?',
            a: `<p>Usually, just open the invite link.</p>
<p>If the person who made the group sent the secret code separately, Starpin will ask you for that too. Once you're in, the group shows up in your Groups tab.</p>`
          },
          {
            id: 'share-find',
            q: 'How do I share a find?',
            a: `<p>After you bag something, Starpin can offer to share it. You can also come back much later and share an old find from your Log or from the target itself.</p>
<p>Because one place can have a whole story attached - a distant first attempt, a better approach later, and finally a culmination - Starpin shows those related records together and lets you choose which to share. Nothing goes anywhere until you tap Share.</p>`
          },
          {
            id: 'old-finds',
            q: 'Can I share something I found ages ago?',
            a: `<p>Absolutely. Your own log is the master copy, so a find from last year is just as shareable as one from five minutes ago.</p>`
          },
          {
            id: 'who-in-charge',
            q: 'Who\u2019s in charge of a group?',
            a: `<p>For now, nobody.</p>
<p>The family-and-friends version is deliberately simple: no accounts, no admins, no approval queues, no moderators. Everyone with the group's invite and secret can take part. That makes it easy - but it also means you should treat a group invite a bit like a house key, and give it to people you trust. A more managed version for clubs, classes and organisations is planned separately.</p>`
          },
          {
            id: 'leave-group',
            q: 'Can I leave a group?',
            a: `<p>Yes. Tap <strong>Leave group</strong> and Starpin removes it from this device. Your own Starpin log is untouched.</p>
<p>Anything you already shared, though, may still exist in the group and on other members' devices. Leaving isn't a time machine.</p>`
          },
          {
            id: 'duplicate-names',
            q: 'Why do two groups have the same name?',
            a: `<p>Because group names don't have to be unique. If you've got two called "Family", Starpin shows a little identifier beside each one so you can tell them apart. That identifier is just a label - it isn't the group's secret.</p>`
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
            a: `<p>Your own Starpin log lives on your device. That's your collection - the record of where you've been.</p>
<p>Group sharing never replaces it. When you share something, Starpin sends an encrypted copy to the group; anything coming back from a group lives separately and can't overwrite one of your own logged finds.</p>`
          },
          {
            id: 'encrypted',
            q: 'Is group sharing encrypted?',
            a: `<p>Yes. Shared finds are encrypted on your device before they're sent. Someone needs the group's invitation information and its secret code to work out the keys to read them. The storage service only ever receives the encrypted data, not the readable visit.</p>`
          },
          {
            id: 'can-starpin-read',
            q: 'Can Starpin read my private group finds?',
            a: `<p>The storage service doesn't receive your visit as readable text, coordinates, or a place name - it stores an encrypted blob it has no key for.</p>
<p>Like any online service, though, it can see some technical information about connections - that data was read or written, and roughly when. So the promise isn't "the internet can see absolutely nothing." It's simpler and honest: your private group content is encrypted, and the storage service doesn't hold the key to read it.</p>`
          },
          {
            id: 'other-groups',
            q: 'Can another group see ours?',
            a: `<p>No. Being in one private group doesn't let someone browse others. There's no directory listing all the Starpin groups, their members and everywhere they've been. You see the groups you belong to and the things shared with them, and nothing about anyone else's.</p>`
          },
          {
            id: 'invite-leaks',
            q: 'What if someone gets our group invite?',
            a: `<p>Treat the invite and secret as the key to the group: someone who has them can read the group's shared finds and add to it. If they end up with someone you no longer trust, the simplest option in this trial version is to make a fresh group.</p>`
          },
          {
            id: 'can-others-delete',
            q: 'Can another member delete my finds?',
            a: `<p>They can't delete anything from your own log, and ordinary group members can't edit or remove shared items that have already been stored.</p>
<p>That said, your personal log is still data on a device - phones get lost, browsers get cleared, computers die. If your Starpin history matters to you, keep a backup.</p>`
          },
          {
            id: 'presence',
            q: 'Does sharing prove somebody really went there?',
            a: `<p>Not yet. A Starpin record carries the location fix from that person's device, but this family version doesn't cryptographically prove to everyone else that they were standing there. So private groups still involve a little old-fashioned trust - which is probably healthy for a game played with your family.</p>`
          },
          {
            id: 'finished',
            q: 'Is this finished?',
            a: `<p>Definitely not. This is still a trial, and the sharing system is deliberately kept in a separate test world while it grows. Your own Starpin log is the part that matters most - those are your finds. The social layer around them is still taking shape, and that's partly the fun: Starpin is still discovering what it wants to become.</p>`
          }
        ]
      }

    ]
  };

  global.STARPIN_FAQ = STARPIN_FAQ;
  if (typeof module !== 'undefined' && module.exports) module.exports = STARPIN_FAQ;

})(typeof self !== 'undefined' ? self : this);
