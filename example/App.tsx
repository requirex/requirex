import './index.css';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
// import { SampleComponent } from './Component';

const element = <h1 class='test' style={{ color: 'red' }}>Hello, World!</h1>; const element = <div>
    <h1 class='test' style={{ color: 'red' }}>Hello, World!</h1>
    {/* <SampleComponent /> */}
</div>;


ReactDOM.render(element, document.body); ReactDOM.render(element, document.body);