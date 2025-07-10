import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { JSDOM } from 'jsdom'

const outDir = path.resolve(process.cwd(), "build");
const packsCompiled = path.resolve(outDir, "packs/");
if (!existsSync(packsCompiled)) {
    console.error("Packs directory does not exist in the build");
}

const packFolders = await fs.readdir(packsCompiled);

console.log("Cleaning packs");
for (const pack of packFolders) {
    const files = await fs.readdir(`packs/${pack}`, { withFileTypes: true });
    const jsonFiles = files
        .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".json"))
        .map((f) => f.name);
    for (const file of jsonFiles) {
        await fs.rm(path.resolve("packs", pack, file));
    }
}

function fix(entry, key, parent) {
    // Fix prototype tokens not matching actor names
    if (key === "prototypeToken") {
        if (entry[key].name !== entry.name) {
            console.warn(`Replaced "${entry[key].name}" to "${entry.name}" in token prototype!`)
            entry[key].name = entry.name
        }
    }

    // Fix token names not matching actor names
    if (key === "tokens") {
        entry["tokens"] = entry["tokens"].map((token) => {
            const actor = parent.actors.find((val) => val._id === token.actorId)

            if (!actor) throw new Error(`"${entry.name}" scene inside ${parent.name} has a token ${entry} not have a matching actor!`)

            if (token.name !== actor.name) {
                console.warn(`Replaced "${token.name}" to "${actor.name}" on the ${entry.name} scene!`)
                token.name = actor.name
            }

            return token
        })
    }

    if (key === "journal" && Array.isArray(entry["journal"])) {
        entry["journal"] = entry["journal"].map((journal) => {
            journal.pages = journal.pages.map((page) => {
                page.text.content = fixHeliana(page.text.content, page)

                return page
            })

            return journal
        })
    }
}

function fixHeliana(text, page) {
    const dom = new JSDOM(text)

    function changeTagName(el, newTagName) {
        const n = dom.window.document.createElement(newTagName);
        const attr = el.attributes;
        for (let i = 0, len = attr.length; i < len; ++i) {
            n.setAttribute(attr[i].name, attr[i].value);
        }
        n.innerHTML = el.innerHTML;
        el.parentNode.replaceChild(n, el);
    }

    const hitList = [
        ["Heliana-Book-1-Styles_Titles_Title-2-No-Link", "h2"],
        ["Heliana-Book-1-Styles_Paragraph-Texts_Para-3-Bullets", "li"],
        ["Heliana-Book-1-Styles_Sidebar_Sidebar-Para-3-Bullets", "li"],
        ["Heliana-Book-1-Styles_Titles_Title-5--Table-", "h5"],
        ["Superscript", "sup"],
        ["Bold", "strong"],
        ["Italics", "i"],
        ["Italic-8", "i"]
    ].flatMap(x => [x, [`${x[0]}-Last`, x[1]]])

    for (const hit of hitList) {
        const titlesAsParagraphs = dom.window.document.getElementsByClassName(hit[0])
        for (let i = 0; i < titlesAsParagraphs.length; i++) {
            if (titlesAsParagraphs[i].nodeName === hit[1].toUpperCase()) continue;

            changeTagName(titlesAsParagraphs[i], hit[1]);
            console.warn(`Replaced "${hit[0]}" to be inside of a <${hit[1]}> element inside ${page.name} page!`)
        }
    }

    return dom.window.document.body.innerHTML
}

for (const pack of packFolders) {
    console.log(`Extracting pack: ${pack}`);
    await extractPack(path.resolve(packsCompiled, pack), `packs/${pack}`, {
        transformEntry: (entry) => {
            Object.keys(entry).forEach((key) => {
                // Fixes PDF mistakes such as " . ", "te- xt". Does not fix line-breaks.
                entry[key] = JSON.parse(
                    JSON.stringify(entry[key])
                        .replaceAll(" . ", ". ")
                        .replaceAll(" .<", ".<")
                        .replaceAll(" .\"", ".\"")
                        .replaceAll(/(\D)- /g, "$1")
                        .replaceAll(/Compendium\.heliana-core(.+)\]/g, (match, p1) => {
                            console.warn("Found a heliana-core tag! Replacing with wrong-module.")
                            return `Compendium.wrong-module${p1}]`
                        })
                        .replaceAll(/,"modifiedTime":\d+/g, "")
                        .replaceAll(/,"lastModifiedBy":"\w+"/g, "")
                )

                fix(entry, key)
            })

            if (entry._key && entry._key.includes("adventure")) {
                // Grab every key in adventure
                Object.keys(entry).forEach((adventureKey) => {
                    if (!Array.isArray(entry[adventureKey])) return; // See if its a collection

                    // Execute on every collection
                    entry[adventureKey] = entry[adventureKey].map((itemEntry) => {
                        // Fix each key inside individual item of a collection
                        Object.keys(itemEntry).forEach((itemKey) => {
                            fix(itemEntry, itemKey, entry)
                        })
                        return itemEntry
                    })

                })
            }
        }
    });
}

console.log("Extraction Complete");