const test = require("node:test");
const assert = require("node:assert/strict");

test("Graph traversal regression: handles subgraph string IDs and promoted widgets", async () => {
    const graphModule = await import("../../js/preview/graph.js");
    const getInputLink = graphModule.getInputLink;

    const mockGraph = {
        _nodes: [
            {
                id: 1,
                outputs: [
                    { name: "image", links: ["link_A"] }
                ]
            }
        ],
        links: {
            "link_A": [ "link_A", 1, 0, 2, 1 ] // id, origin_id, origin_slot, target_id, target_slot
        }
    };

    const mockNode = {
        id: 2,
        graph: mockGraph,
        inputs: [
            { name: "promoted_widget", link: null }, // index 0
            { name: "image", link: "link_A" }        // index 1
        ],
        getInputLink: undefined // simulate missing native method
    };

    const link = getInputLink(mockNode, 1);
    
    assert.ok(link, "Should resolve link_A");
    assert.equal(link.origin_id, 1, "Origin ID should be 1");
    assert.equal(link.origin_slot, 0, "Origin slot should be 0");
    assert.equal(link.target_id, 2, "Target ID should be 2");
    assert.equal(link.target_slot, 1, "Target slot should be 1");
});
