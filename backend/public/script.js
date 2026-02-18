// Global variables
let applications = [];
let currentFilter = 'pan'; // Default to pan view for submitted applications

// Fetch applications on load
document.addEventListener('DOMContentLoaded', () => {
    fetchApplications();
    
    // Add filter buttons if needed
    addFilterButtons();
});

function addFilterButtons() {
    const filterContainer = document.querySelector('.panel-header div:first-child');
    if (filterContainer) {
        const filterDiv = document.createElement('div');
        filterDiv.style.marginTop = '10px';
        filterDiv.innerHTML = `
            <button class="btn ${currentFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setFilter('all')">All</button>
            <button class="btn ${currentFilter === 'pan' ? 'btn-primary' : 'btn-outline'}" onclick="setFilter('pan')">PAN</button>
            <button class="btn ${currentFilter === 'll' ? 'btn-primary' : 'btn-outline'}" onclick="setFilter('ll')">LL</button>
        `;
        filterContainer.appendChild(filterDiv);
    }
}

function setFilter(filter) {
    currentFilter = filter;
    
    // Update button styles
    document.querySelectorAll('.panel-header .btn').forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
    });
    event.target.classList.remove('btn-outline');
    event.target.classList.add('btn-primary');
    
    // Update table title based on filter
    const titleMap = {
        'all': 'All Applications',
        'pan': 'PAN Card Applications',
        'll': 'Learner License Applications'
    };
    document.getElementById('table-title').textContent = titleMap[filter] || 'Applications';
    
    renderTable();
}

async function fetchApplications() {
    try {
        const response = await fetch('http://localhost:5000/api/applications');
        applications = await response.json();
        renderTable();
    } catch (error) {
        console.error('Error fetching applications:', error);
    }
}

function renderTable() {
    const thead = document.getElementById('table-head');
    const tbody = document.getElementById('table-body');
    const search = document.getElementById('search-input').value.toLowerCase();
    
    tbody.innerHTML = '';
    thead.innerHTML = '';

    // Determine headers based on filter
    let headers = [];
    if (currentFilter === 'all') {
        headers = ['ID', 'Date', 'Category', 'Name', 'Mobile', 'Password', 'Wallet Bal', 'Status', 'Action'];
    } else if (currentFilter === 'pan') {
        headers = ['ID', 'Date', 'Category', 'Name', 'Mobile', 'Aadhar No', 'Password', 'Status', 'Action'];
    } else {
        headers = ['ID', 'Date', 'Category', 'Name', 'Mobile', 'App No', 'DOB', 'Password', 'Status', 'Action'];
    }

    // Render headers
    let headerHTML = '<tr>';
    headers.forEach(h => {
        headerHTML += `<th>${h}</th>`;
    });
    headerHTML += '</tr>';
    thead.innerHTML = headerHTML;

    // Filter data
    let filtered = applications.filter(app => {
        if (currentFilter === 'all') return true;
        return app.type === currentFilter;
    });

    filtered = filtered.filter(app => 
        app.name.toLowerCase().includes(search) || 
        (app.aadhar && app.aadhar.includes(search)) ||
        app.mobile.includes(search) ||
        String(app.id).includes(search)
    );

    if(filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${headers.length}" style="text-align:center; padding:30px; color:var(--text-muted);">No records found</td></tr>`;
        return;
    }

    // Render rows
    filtered.forEach(app => {
        const statusClass = app.status === 'active' ? 'badge-active' : 'badge-pending';
        const statusText = app.status === 'active' ? 'Active' : 'Pending';
        const typeBadge = app.type === 'll' ? 'badge-ll' : 'badge-pan';
        const typeName = app.type === 'll' ? 'LL' : 'PAN';

        let rowHTML = `<tr>
            <td style="font-family:monospace; color:var(--text-muted);">#${app.id}</td>
            <td>${app.date}</td>
            <td><span class="badge-type ${typeBadge}">${typeName}</span></td>
            <td style="font-weight: 500; color: #1e293b;">${app.name}</td>
            <td>${app.mobile}</td>`;

        // Conditional Columns
        if (currentFilter === 'all') {
            rowHTML += `
                <td><code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${app.password}</code></td>
                <td style="font-weight:600; color:var(--success);">₹${app.walletBal}</td>
            `;
        } else if (currentFilter === 'pan') {
            rowHTML += `
                <td style="font-weight:600; color:#c2410c;">${app.aadhar}</td>
                <td><code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${app.password}</code></td>
            `;
        } else {
            rowHTML += `
                <td style="font-family:monospace;">${app.appNo || '-'}</td>
                <td>${app.dob || '-'}</td>
                <td><code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${app.password}</code></td>
            `;
        }

        // Status
        rowHTML += `<td><span class="badge ${statusClass}">${statusText}</span></td>`;

        // Action Column
        if (currentFilter === 'all') {
            rowHTML += `<td style="text-align: right;">
                <button class="btn btn-outline btn-sm" onclick="openPasswordModal(${app.id})">Update</button>
                <button class="btn btn-danger btn-sm" onclick="deleteApplication(${app.id})">Delete</button>
            </td>`;
        } else {
            rowHTML += `<td style="text-align: right;">
                <button class="btn btn-primary btn-sm" onclick="openEditModal(${app.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteApplication(${app.id})">Delete</button>
            </td>`;
        }

        rowHTML += `</tr>`;
        tbody.innerHTML += rowHTML;
    });
}

async function deleteApplication(id) {
    if (confirm('Are you sure you want to delete this application?')) {
        try {
            await fetch(`http://localhost:5000/api/applications/${id}`, {
                method: 'DELETE'
            });
            await fetchApplications(); // Refresh the list
        } catch (error) {
            console.error('Error deleting application:', error);
        }
    }
}

function resetFilter() {
    document.getElementById('search-input').value = '';
    renderTable();
}