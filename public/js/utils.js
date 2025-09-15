
function sortTable(nametable, columnIndex, customOrder=[]) {
    
    const table = document.getElementById(nametable);
    const header = table.tHead.rows[0].cells[columnIndex];
    const sortDirection = header.getAttribute('data-sort');
    const rows = Array.from(table.rows).slice(1); // Exclude header row

    const sortedRows = rows.sort((a, b) => {
       
        const cellA = a.cells[columnIndex].querySelector('p').title.toLowerCase();
        const cellB = b.cells[columnIndex].querySelector('p').title.toLowerCase();

        return sortDirection === 'asc' ? customOrder.indexOf(cellA) - customOrder.indexOf(cellB) : customOrder.indexOf(cellB) - customOrder.indexOf(cellA);
        return sortDirection === 'asc' ? cellA.localeCompare(cellB) : cellB.localeCompare(cellA);
    });

    sortedRows.forEach(row => table.tBodies[0].appendChild(row));
    header.setAttribute('data-sort', sortDirection === 'asc' ? 'desc' : 'asc');
    
}

// function restoreOriginalOrder(nametable) {
//     document.getElementById('header-sentiment').setAttribute('data-sort','desc');
//     document.getElementById('header-SEG').setAttribute('data-sort','asc');
   
//     const table = document.getElementById(nametable);
//     const tbody = table.getElementsByTagName('tbody')[0];
//     const rows = Array.from(tbody.getElementsByTagName('tr'));

//     const header = table.tHead.rows[0].cells[2];
//     const sortDirection = header.getAttribute('data-sort');

//     rows.sort((a, b) => {
//         return sortDirection === 'asc' ?  parseInt(a.dataset.originalIndex, 10) - parseInt(b.dataset.originalIndex, 10) : parseInt(b.dataset.originalIndex, 10) - parseInt(a.dataset.originalIndex, 10);
//     });

//     rows.forEach(row => tbody.appendChild(row));
//     header.setAttribute('data-sort', sortDirection === 'asc' ? 'desc' : 'asc');
//     countRows(nametable);
// }


function urgentCases(){
    document.getElementById('header-title').setAttribute('data-sort','desc');
    restoreOriginalOrder('caseTable');
    document.getElementById('header-sentiment').click();
    document.getElementById('header-SEG').click();
    highlightUrgentCases('caseTable');
}

function highlightUrgentCases(nametable){
    const table = document.getElementById(nametable);
    const rows = Array.from(table.getElementsByTagName('tr'));

    rows.forEach((row, index) => {
        if (index === 0) return; // Skip the header row
        const cells = row.getElementsByTagName('td');
        if (cells[1].querySelector('p').title.toLowerCase() === 'trending negative' && cells[5].querySelector('p').title.toLowerCase() === 'not applicable') {
            const originalBgColor = window.getComputedStyle(row).backgroundColor;
            row.style.setProperty('--original-bg-color', originalBgColor);
            row.classList.add('high-importance');
        }
    });
    countRows(nametable);
}

function showClosed(nametable) {
    const table = document.getElementById(nametable);
    const rows = table.tBodies[0].rows;
    for (let i = 0; i < rows.length; i++) {
        showRow(rows[i]);
    }
}

function filterTable(nametable) {
    const dropdown1 = document.getElementById('PSEfilterDropdown');
    const dropdown2 = document.getElementById('SentimentfilterDropdown');
    const dropdown3 = document.getElementById('SEGfilterDropdown');
    const filterValue1 = dropdown1.value;
    const filterValue2 = dropdown2.value;
    const filterValue3 = dropdown3.value;

    const table = document.getElementById(nametable);
    const rows = table.tBodies[0].rows;
   
    for (let i = 0; i < rows.length; i++) {
        const cData1 = rows[i].cells[3].textContent.trim();
        const cData2 = rows[i].cells[1].querySelector('p').title.toLowerCase();
        const cData3 = rows[i].cells[5].querySelector('p').title.toLowerCase();

        rows[i].style.display = 'none'; 
        if (filterValue1 === 'All' || cData1.includes(filterValue1)) {
            if (filterValue2 === 'All' || cData2.includes(filterValue2)) {
                if (filterValue3 === 'All' || cData3.includes(filterValue3)) {
                    showRow(rows[i]); 
                }
            }    
        } 
    }

    document.getElementById('header-title').setAttribute('data-sort','asc');
    restoreOriginalOrder(nametable);
}

function restartFilters(nametable) {
    document.getElementById('header-title').setAttribute('data-sort','asc');
    restoreOriginalOrder(nametable);
    document.getElementById('PSEfilterDropdown').selectedIndex = 0;
    document.getElementById('SentimentfilterDropdown').selectedIndex = 0;
    document.getElementById('SEGfilterDropdown').selectedIndex = 0;
    filterTable(nametable);
}

function showRow(nametable){
    const table = document.getElementById(nametable);
    const rows = table.tBodies[0].rows;
    const toHide = [];
    const toShow = [];
    
    let open_checkbox = document.getElementById('openCheckbox').classList.contains('checked');

    for (let i = 0; i < rows.length; i++) {
        if (!open_checkbox && rows[i].dataset.caseStatus == "open") {
            toHide.push(i); // Save indices or row references
        } 
        if (open_checkbox && rows[i].dataset.caseStatus == "open") {
            toShow.push(i);
        }
    }

    for (const i of toHide) {
        //rows[i].classList.add('hide-row');
    }
    
    for (const i of toShow) {
        //rows[i].classList.remove('hide-row');
    }

    console.log("hide " + toHide.length);
    console.log("swho " + toShow.length)
    // paginar
    
    // for (let i = 0; i < rows.length; i++) {
    //     let row = rows[i];
    //     let closed_checkbox = document.getElementById('closedCheckbox').classList;
    //     let open_checkbox = document.getElementById('openCheckbox').classList.contains('checked');
    //     let L4_checkbox = document.getElementById('l4Checkbox').classList;
    //     let L5_closed_checkbox = document.getElementById('l5Checkbox').classList;
        
    //     row.classList.remove('hide-row');
    //     // if(!closed_checkbox.contains('checked') && row.dataset.caseStatus == "closed") {
    //     //     row.style.display = 'none'; 
    //     // }
    //     if(!open_checkbox && row.dataset.caseStatus == "open") {
    //         row.classList.add('hide-row');
    //     }

    // }
    //
}

function countRows(nametable) {
    let visibleRowCount = 0;
    const table = document.getElementById(nametable);
    const tbody = table.getElementsByTagName('tbody')[0];
    const rows = Array.from(tbody.getElementsByTagName('tr'));
    rows.forEach(row => {
        if (!row.classList.contains('hide-row')) {
            visibleRowCount++;
        }
    });
    document.getElementById('nCases').innerText=visibleRowCount;
}


function formatSQLDate(dateString) {

  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const year = date.getFullYear();
  return `${day}-${month}-${year}`; // Format as DD-MM-YYYY
}