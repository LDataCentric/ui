import { Component, OnInit, ViewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { first } from 'rxjs/operators';
import { AuthApiService } from 'src/app/base/services/auth-api.service';
import { NotificationService } from 'src/app/base/services/notification.service';
import { NotificationApolloService } from 'src/app/base/services/notification/notification-apollo.service';
import { OrganizationApolloService } from 'src/app/base/services/organization/organization-apollo.service';
import { ProjectApolloService } from 'src/app/base/services/project/project-apollo.service';
import { ProjectStatus } from '../../enums/project-status.enum';
import { Project } from 'src/app/base/entities/project';
import { RouteService } from 'src/app/base/services/route.service';
import { ActivatedRoute, Router } from '@angular/router';
import { UploadComponent } from 'src/app/import/components/upload/upload.component';
import { Subscription, timer } from 'rxjs';
import { UploadRecordsComponent } from 'src/app/import/components/upload-records/upload-records.component';
import { ConfigManager } from 'src/app/base/services/config-service';

@Component({
  selector: 'kern-project-new',
  templateUrl: './project-new.component.html',
  styleUrls: ['./project-new.component.scss']
})
export class ProjectNewComponent implements OnInit {

  user$: any;
  subscriptions$: Subscription[] = [];
  createNewProject: FormGroup;
  selectedTokenizer = 'en_core_web_sm';
  tokenizerValues = [];
  checkIfUpload: boolean;
  project: Project;
  projectNameList$;
  projectNameListQuery$: any;
  projectNameList: Project[] = [];
  hasFileUploaded: boolean = false;
  submitted: boolean = false;
  file: File;
  @ViewChild(UploadComponent) uploadComponent;
  @ViewChild(UploadRecordsComponent) uploadRecordsComponent;
  openTab: number = 0;
  organizationName: string;
  organizationInactive: boolean;
  avatarUri: string;


  constructor(
    private routeService: RouteService,
    private activatedRoute: ActivatedRoute,
    private auth: AuthApiService,
    private formBuilder: FormBuilder,
    private organizationApolloService: OrganizationApolloService,
    private projectApolloService: ProjectApolloService,
    private notificationApolloService: NotificationApolloService,
    private router: Router) { }

  ngOnInit(): void {
    this.routeService.updateActivatedRoute(this.activatedRoute);

    this.organizationApolloService
      .getUserOrganization()
      .pipe(first()).subscribe((org) => {
        this.organizationInactive = org == null;
        if (!this.organizationInactive) {
          this.organizationName = org.name;
        }
      });

    this.organizationApolloService.getUserInfo().pipe(first())
      .subscribe((user) => {
        const avatarSelector = (user.firstName[0].charCodeAt(0) + user.lastName[0].charCodeAt(0)) % 5;
        this.avatarUri = "assets/avatars/" + avatarSelector + ".png"
      });

    this.createNewProject = this.formBuilder.group({
      projectTitle: ['', [Validators.required, Validators.pattern(/^(\s+\S+\s*)*(?!\s).*$/), this.orgExists()]],
      description: [''],
      tokenizerForm: [this.selectedTokenizer]
    });

    [this.projectNameListQuery$, this.projectNameList$] = this.projectApolloService.getProjects();
    this.subscriptions$.push(this.projectNameList$.subscribe((projectList) => {
      this.projectNameList = projectList;
    }));

    NotificationService.subscribeToNotification(this, {
      whitelist: ['project_created', 'project_deleted', 'project_update', 'file_upload'],
      func: this.handleWebsocketNotification
    });


    this.projectApolloService
      .getAllTokenizerOptions()
      .pipe(first())
      .subscribe((v) => {
        this.tokenizerValues = this.checkWhitelistTokenizer(v);
      });
  }

  get f() { return this.createNewProject.controls; }

  handleWebsocketNotification(msgParts) {
    if (!this.projectNameListQuery$) return;
    if (['project_created', 'project_deleted', 'project_update'].includes(msgParts[1])) {
      this.projectNameListQuery$.refetch();
    }
  }

  getFirstName(userName) {
    this.user$ = userName;
  }

  ngOnDestroy(): void {
    this.subscriptions$.forEach(subscription => subscription.unsubscribe());
    NotificationService.unsubscribeFromNotification(this);
  }

  canCreateProject(): boolean {
    if (!this.createNewProject.get('projectTitle')?.value) return false;
    if (this.createNewProject.get('projectTitle').value.trim() == '') return false;
    for (const p of this.projectNameList) if (p.name == this.createNewProject.get('projectTitle').value) return false;
    return true;
  }

  initializeProject(isInput: boolean, event?: Event) {
    if (isInput) {
      event.preventDefault();
    }

    this.uploadRecordsComponent.submitted = true;
    this.submitted = true;
    if (this.createNewProject.invalid) return;
    this.createNewProject.setValue({
      projectTitle: (this.createNewProject.get('projectTitle').value).trim(),
      description: (this.createNewProject.get('description').value).trim(),
      tokenizerForm: this.createNewProject.get('tokenizerForm').value,
    });

    if (this.submitted && this.hasFileUploaded) {
      //console.log("entrou");
      this.projectApolloService
        .createProject(this.createNewProject.get('projectTitle').value.trim(), this.createNewProject.get('description').value.trim())
        .pipe(first()).subscribe((p: Project) => {
          console.log(p)
          this.project = p;
          this.uploadRecordsComponent.projectId = p.id;
          this.uploadRecordsComponent.selectedTokenizer = this.createNewProject.get('tokenizerForm').value;
          this.uploadRecordsComponent.submitUploadRecords();
        //   this.router.navigate(['projects', p.id, 'settings']);
        //   this.notificationApolloService.createNotification(p.id, "Project added successfully!")
        // .pipe(first())
        // .subscribe();
        });
    }
  }

  checkWhitelistTokenizer(tokenizer) {
    if (!ConfigManager.isInit()) {
      timer(250).subscribe(() => this.tokenizerValues = this.checkWhitelistTokenizer(tokenizer));
      return null;
    }
    tokenizer = Array.from(tokenizer);
    const allowedConfigs = ConfigManager.getConfigValue("spacy_downloads");
    for (let i = 0; i < tokenizer.length; i++) {
      tokenizer[i].disabled = !allowedConfigs.includes(tokenizer[i].configString);
    }
    tokenizer.sort((a, b) => (+a.disabled) - (+b.disabled) || a.configString.localeCompare(b.configString));

    let firstNotAvailable = true;
    let insertPos = -1;
    for (let i = 0; i < tokenizer.length; i++) {
      const t = tokenizer[i];
      if (t.disabled) {
        if (firstNotAvailable) {
          insertPos = i;
          firstNotAvailable = false;
        }
      } else t.disabled = null;
    }

    if (insertPos != -1) {
      tokenizer.splice(insertPos, 0, { disabled: true, name: "------------------------------------------" });
      if (ConfigManager.getIsManaged()) {
        tokenizer.splice(insertPos, 0, { disabled: true, name: "if you need the options below feel free to contact us", configString: "intercom/email" });
      } else {
        tokenizer.splice(insertPos, 0, { disabled: true, name: "add further options on config page" });
      }
      tokenizer.splice(insertPos, 0, { disabled: true, name: "------------------------------------------" });
    }

    return tokenizer
  }

  orgExists(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null =>
      this.projectNameList && this.projectNameList.find(project => project.name.toLowerCase() == (control.value as string)?.trim().toLowerCase())
        ? { projectTitleExists: control.value } : null;
  }

  checkIfFileUploaded(hasFileUploaded: boolean) {
    this.hasFileUploaded = hasFileUploaded;
  }
}
