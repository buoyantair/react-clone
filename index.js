const h = (type, props = {}, children = []) => ({
  type,
  props,
  children
});

const memoize = component => {
  // We need to record the previous props and return value of the component.
  // On the first call these are empty
  let lastProps = null;
  let lastResult = null;

  // We return a new component that uses the cached values for
  // optimization purposes
  return props => {
    // If the props have changed since the last function call,
    // we invoke the component with the new props and store the result
    if (!shallowEqual(props, lastProps)) {
      lastResult = component(props);
      lastProps = props;

      // We also record whether the result came from the cache. We will
      // use this information later when we create the vDOM
      lastResult.memoized = true;
    } else {
      lastResult.memoized = false;
    }

    // Finally we return the cached value. This is referential transparency
    // at work (i.e. we can replace the component invocation with its value)
    return lastResult;
  };
};

const createVDOM = (element, id = ".") => {
  // This function must be called recursively for all descendants
  // in order to transform the entire tree
  const newElement = {
    ...element,
    id,
    children: element.children.map((child, index) =>
      createVDOM(child, `${id}${index}.`)
    )
  };

  // Is this a component?
  if (typeof element.type === "function") {
    // Call the component and pass in the props.
    // Returns the generated subtree
    const subtree = newElement.type(element.props);

    // Call ourself recursively in order to assign the right ID
    // to the nodes and process any subcomponents in the subtree
    if (subtree.memoized) {
      return subtree;
    } else {
      return createVDOM(subtree, id);
    }
  } else {
    // If we come across an element that is not a function,
    // all we have to do is return it
    return newElement;
  }
};

const diff = (left, right, patches, parent = null) => {
  // If the left side (i.e. current vDOM) node does not exist, we have to create it.
  // In this case we don't have to keep recursing since the creation process
  // itself is recursive
  if (!left) {
    patches.push({
      parent, // We pass in the parent of the left side node
      // so we know whether to attach the newly create descendants
      type: PatchTypes.PATCH_CREATE_NODE,
      node: right // And of course we pass in the newly created node
    });
  } else if (!right) {
    // If the right side (i.e. the new vDOM) node doesn't exist,
    // we need to remove the node from the vDOM
    patches.push({
      type: PatchTypes.PATCH_REMOVE_NODE,
      node: left // We just need to pass in the node to remove
    });
  } else if (left.type !== right.type) {
    // Here the type is changing and so we assume that the subtree
    // has changed and halt the recursion, greatly speeding up
    // the algorithm
    patches.push({
      type: PatchTypes.PATCH_REPLACE_NODE,
      replacingNode: left,
      node: right
    });
  } else if (right.memoized) {
    // Here we have another excellent and very effective optimization.
    // If we know that we are dealing with a memoized node, we
    // don't need to bother traversing the rest of the subtree since we
    // can be sure that its vDOM has not changed
    return;
  } else {
    // Now we iterate over all descendants of the left of right side
    // and call ourself recursively
    const children =
      left.children.length >= right.children.length
        ? left.children
        : right.children;

    children.forEach((child, index) =>
      diff(left.children[index], right.children[index], patches, left)
    );
  }
};

const patches = [];

// const RootComponent = ({ showDiv }) => {
//   if (showDiv) {
//     return h("div", {}, ["Hello World"]);
//   } else {
//     return h("span", {}, ["Hello World"]);
//   }
// };

// // We create one tree that uses div
// const leftVDOM = createVDOM(h(RootComponent, { showDiv: true }));

// // ...and a second that uses span
// const rightVDOM = createVDOM(h(RootComponent, { showDiv: false }));
// diff(leftVDOM, rightVDOM, patches);

const ID_KEY = "data-react-id";

// The correlation between vDOM and DOM nodes is simple.
// We just use the ID which we have recorded in the vDOM and place it in an
// HTML attribute of the actual DOM node
const correlateVDOMNode = (vdomNode, domRoot) => {
  if (vdomNode === null) {
    return domRoot;
  } else {
    return document.querySelector(`[${ID_KEY}="${vdomNode.id}"]`);
  }
};

// Creating the DOM node based on a vDOM node is a recursive operation,
// as we have already mentioned in the chapter about finding changes
// in the individual subtrees
const createNodeRecursive = (vdomNode, domNode) => {
  // Create a DOM element of the appropriate type
  const domElement = document.createElement(vdomNode.type);
  // Set the ID attribute so we can later correlate the vDOM and DOM
  domElement.setAttribute(ID_KEY, vdomNode.id);
  // And finally add the node to the DOM
  domNode.appendChild(domElement);

  // Recurse over the vDOM node's children
  vdomNode.children.forEach(child => createNodeRecursive(child, domElement));
};

const applyPatch = (patch, domRoot) => {
  switch (patch.type) {
    case PatchTypes.PATCH_CREATE_NODE:
      {
        // First find the DOM node which corresponds to the vDOM node's parent
        const domNode = correlateVDOMNode(patch.parent, domRoot);

        // Recursively create the DOM node
        createNodeRecursive(patch.node, domNode);
      }
      break;

    case PatchTypes.PATCH_REMOVE_NODE:
      {
        // Find the DOM node that corresponds to the vDOM node that we
        // want to remove
        const domNode = correlateVDOMNode(patch.node, domRoot);

        // After that we just remove the node from its parent
        domNode.parentNode.removeChild(domNode);
      }
      break;

    case PatchTypes.PATCH_REPLACE_NODE:
      {
        // Find the DOM node that we want to replace
        const domNode = correlateVDOMNode(patch.replacingNode, domRoot);

        // Remove the node from its parent
        const parentDomNode = domNode.parentNode;
        parentDomNode.removeChild(domNode);

        // Recursively create the new node
        createNodeRecursive(patch.node, parentDomNode);
      }
      break;

    default:
      throw new Error(`Missing implementation for patch ${patch.type}`);
  }
};

export const createRender = domElement => {
  let lastVDOM = null;
  let patches = null;

  return element => {
    // First we create a new vDOM
    const vdom = createVDOM(element);

    // Next we get all the changes between the previous vDOM and the new one
    patches = [];
    diff(lastVDOM, vdom, patches);

    // Each patch is applied to the DOM
    patches.forEach(patch => applyPatch(patch, domElement));

    // Finally we record the new vDOM so we can use it for comparison purposes
    // during the next render cycle
    lastVDOM = vdom;
  };
};

// Simple demonstration that displays a modified DOM after a specified interval
const render = createRender(document.getElementById("app"));

let loggedIn = false;
setInterval(() => {
  loggedIn = !loggedIn;

  render(
    h(RootComponent, {
      user: loggedIn ? { name: "Tomas Weiss" } : null
    })
  );
}, 1000);
