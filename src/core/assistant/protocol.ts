/**
 * Model-facing protocol text (contract: contracts/assistant-protocol.md). The
 * parser lives in the same contract and is implemented in `parser.ts`; keeping
 * the text here means the instructions and the parser ship together.
 */

export const PROPOSE_PROTOCOL_TEXT = `Reply with a short explanation in plain prose, then one operation block per change.
Only use handles from the workspace context. Name new items with a temporary ref
("new1", "new2") that later blocks may use as parent or id.

<op type="create_entry" parent="HANDLE_OR_REF" ref="new1">
<title>Entry title</title>
<keys>keyword one, keyword two</keys>
<content>
Entry text (markdown allowed)
</content>
</op>

<op type="edit_entry" id="HANDLE">
(only the tags you change: title, keys, secondary_keys, content, fields)
<fields>position=at_depth, depth=2</fields>
</op>

<op type="create_folder" parent="HANDLE_OR_REF" ref="new2"><title>Folder name</title></op>
<op type="rename" id="HANDLE"><title>New name</title></op>
<op type="move" id="HANDLE_OR_REF" parent="HANDLE_OR_REF"></op>
<op type="delete" id="HANDLE"></op>

Edits replace the whole value of each tag you include (send the full new content).
Refer to existing items in prose as [[HANDLE]].
Do not repeat ideas the user denied. If nothing should change, reply with prose only.`;

export const DISCUSS_PROTOCOL_TEXT = `Answer in prose only. Do not output operation blocks.
Refer to items as [[HANDLE]].`;
