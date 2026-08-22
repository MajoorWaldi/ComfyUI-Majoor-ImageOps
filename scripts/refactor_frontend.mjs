import { Project, SyntaxKind } from "ts-morph";
import * as fs from "fs";

const project = new Project();
const implFile = project.addSourceFileAtPath("src/preview/ops/implementation.ts");

const mappings = {
    "src/preview/ops/geometry.ts": [
        "crop", "cropGeneric", "cropReformat", "cropStitch", "pad", "padOut", 
        "resize", "transform", "flipRotate", "cornerPin", "cameraShake", "distort", "spherize"
    ],
    "src/preview/ops/blend.ts": [
        "merge", "composite", "comp"
    ],
    "src/preview/ops/masks.ts": [
        "imageOpsMask", "channelApply"
    ],
    "src/preview/ops/procedural.ts": [
        "constant", "ramp", "noise", "grain", "text", "draw", "drawMask", "keyer", "stitch"
    ],
    "src/preview/ops/video.ts": [
        "channelSplit", "channelMerge"
    ]
};

const opsObj = implFile.getVariableDeclarationOrThrow("ops").getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

for (const [filePath, funcs] of Object.entries(mappings)) {
    let extractedCode = "";
    
    for (const prop of opsObj.getProperties()) {
        if (prop.isKind(SyntaxKind.MethodDeclaration)) {
            const name = prop.getName();
            if (funcs.includes(name)) {
                console.log(`Extracting ${name} to ${filePath}...`);
                const text = prop.getText();
                const funcText = text.replace(new RegExp(`^${name}\\s*\\(`), `export function ${name}(`);
                extractedCode += funcText + "\n\n";
            }
        }
    }

    if (extractedCode) {
        let currentCode = fs.readFileSync(filePath, "utf-8");
        fs.writeFileSync(filePath, currentCode + "\n\n// Extracted with ts-morph\n\n" + extractedCode);
        console.log(`Successfully appended to ${filePath}!`);
    }
}
